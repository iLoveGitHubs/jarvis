'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

function loadEnv() {
  if (process.env.LLM_API_KEY) return;
  try {
    const envPath = path.join(__dirname, '..', '..', '.env');
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
    }
  } catch (_e) {}
}
loadEnv();

function llmConfig() {
  return {
    apiKey: process.env.LLM_API_KEY,
    baseUrl: (process.env.LLM_BASE_URL || 'https://maas-llm-aiplatform-hcm.api.vngcloud.vn/v1').replace(/\/$/, ''),
    model: process.env.L/ process.env.LLM_MODEL || 'z-ai/glm-5.2-hackathon',
  };
}

function hasLlm() {
  return !!process.env.LLM_API_KEY;
}

function callLLM(prompt) {
  const cfg = llmConfig();
  if (!cfg.apiKey) return Promise.reject(new Error('LLM_API_KEY not set'));
  return new Promise((resolve, reject) => {
    const u = new URL(cfg.baseUrl + '/chat/completions');
    const body = JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 1024,
    });
    const r = https.request({
      method: 'POST',
      hostname: u.hostname,
      path: u.pathname,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
          if (content) resolve(content);
          else reject(new Error('LLM returned no content: ' + data.slice(0, 200)));
        } catch (e) { reject(new Error('LLM parse error: ' + data.slice(0, 200))); }
      });
    });
    r.on('error', reject);
    r.write(body);
    r.end();
  });
}

function buildPrompt(req, diff) {
  const acList = (req.acceptanceCriteria && req.acceptanceCriteria.length)
    ? req.acceptanceCriteria.map((ac) => `- ${ac}`).join('\n')
    : '- Thay đổi code hiện thực yêu cầu: ' + (req.description || req.title);
  return `Bạn là một reviewer code nghiêm ngặt. Cho trước diff của một git commit và một yêu cầu phần mềm với tiêu chí chấp nhận, hãy xác định xem diff có thỏa mãn từng tiêu chí không.

Yêu cầu: ${req.id} — ${req.title}
Mô tả: ${req.description || '(không có)'}

Tiêu chí chấp nhận:
${acList}

Commit diff (unified):
\`\`\`diff
${diff}
\`\`\`

Hướng dẫn:
- Phân tích các thay đổi code thực tế trong diff.
- Cho MỖI tiêu chí chấp nhận, quyết định PASS (diff rõ ràng thỏa mãn) hoặc FAIL (không thỏa mãn, hoặc thiếu bằng chứng).
- Nghiêm ngặt: nếu diff không rõ ràng hiện thực tiêu chí, đánh dấu FAIL.
- Trả về CHỈ JSON hợp lệ, không có markdown fence, theo cấu trúc chính xác:
{"criteria":[{"criterion":"AC1","verdict":"PASS","reason":"một câu tiếng Việt"}],"overall":"PASS","summary":"một câu tiếng Việt"}`;
}

function parseVerdict(raw, reqId) {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start > -1 && end > start) text = text.slice(start, end + 1);
  try {
    const j = JSON.parse(text);
    return {
      criteria: Array.isArray(j.criteria) ? j.criteria : [],
      overall: j.overall === 'PASS' ? 'PASS' : 'FAIL',
      summary: j.summary || '',
    };
  } catch (_e) {
    return { criteria: [], overall: 'FAIL', summary: 'LLM response not parseable: ' + raw.slice(0, 120) };
  }
}

async function checkRequirement(req, diff) {
  if (!hasLlm()) {
    return { criteria: [], overall: 'UNCHECKED', summary: 'LLM not configured (LLM_API_KEY missing)' };
  }
  const truncated = diff.length > 8000 ? diff.slice(0, 8000) + '\n... (truncated)' : diff;
  try {
    const raw = await callLLM(buildPrompt(req, truncated));
    return parseVerdict(raw, req.id);
  } catch (e) {
    return { criteria: [], overall: 'ERROR', summary: 'LLM call failed: ' + e.message };
  }
}

function buildReviewPrompt(content) {
  return `Bạn là một chuyên gia phân tích yêu cầu phần mềm. Hãy review tài liệu URD (User Requirements Document) markdown sau đây và đánh giá chất lượng.

URD markdown:
\`\`\`markdown
${content}
\`\`\`

Hãy đánh giá theo các tiêu chí sau:
1. Định dạng: frontmatter có đủ các trường (id, title, version, status)?
2. Rõ ràng: mỗi yêu cầu (REQ/CR) có tiêu đề và mô tả rõ ràng không?
3. Tiêu chí chấp nhận: mỗi yêu cầu có tiêu chí chấp nhận (acceptance criteria) cụ thể và có thể kiểm tra được không?
4. Tính nhất quán: ID yêu cầu có theo quy ước REQ-xxx hoặc CR-xxx không?
5. Thiết sót: có thiếu thông tin gì quan trọng không?

Trả về CHỈ JSON hợp lệ, không có markdown fence, theo cấu trúc:
{"score": 8, "verdict": "TỐT" | "TRUNG BÌNH" | "KÉM", "strengths": ["điểm mạnh 1","điểm mạnh 2"], "weaknesses": ["điểm yếu 1"], "suggestions": ["gợi ý 1"], "requirements": [{"id":"REQ-001","title":"...","criteriaCount": 3,"quality": "TỐT" | "CẦN CẢI THIỆN" | "KÉM","comment": "nhận xét"}]}`;
}

async function reviewUrd(content) {
  if (!hasLlm()) {
    return { score: 0, verdict: 'KHÔNG KHẢ DỤNG', strengths: [], weaknesses: ['LLM chưa cấu hình'], suggestions: [], requirements: [] };
  }
  const truncated = content.length > 6000 ? content.slice(0, 6000) + '\n... (cắt bớt)' : content;
  try {
    const raw = await callLLM(buildReviewPrompt(truncated));
    let text = raw.trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) text = fence[1].trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start > -1 && end > start) text = text.slice(start, end + 1);
    return JSON.parse(text);
  } catch (e) {
    return { score: 0, verdict: 'LỖI', strengths: [], weaknesses: ['LLM lỗi: ' + e.message], suggestions: [], requirements: [] };
  }
}

module.exports = { checkRequirement, hasLlm, llmConfig, reviewUrd };
