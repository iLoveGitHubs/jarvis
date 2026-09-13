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

function buildPrompt(req, diff, fileContents) {
  const acList = (req.acceptanceCriteria && req.acceptanceCriteria.length)
    ? req.acceptanceCriteria.map((ac) => `- ${ac}`).join('\n')
    : '- Thay đổi code hiện thực yêu cầu: ' + (req.description || req.title);
  let fileContext = '';
  if (fileContents && fileContents.length) {
    fileContext = '\n\nNội dung đầy đủ các file bị thay đổi (để xác minh AC đã được hiện thực trong code hiện tại):\n';
    for (const fc of fileContents) {
      fileContext += `\n--- ${fc.file} ---\n\`\`\`\n${fc.content}\n\`\`\`\n`;
    }
  }
  return `Bạn là một reviewer code nghiêm ngặt. Cho trước diff của một git commit, nội dung đầy đủ các file bị thay đổi, và một yêu cầu phần mềm với tiêu chí chấp nhận, hãy xác định xem code có thỏa mãn từng tiêu chí không.

Yêu cầu: ${req.id} — ${req.title}
Mô tả: ${req.description || '(không có)'}

Tiêu chí chấp nhận:
${acList}

Commit diff (unified):
\`\`\`diff
${diff}
\`\`\`
${fileContext}
Hướng dẫn:
- Phân tích cả diff VÀ nội dung đầy đủ các file để xác minh tiêu chí.
- Một tiêu chí ĐẠT (PASS) nếu code hiện tại có vẻ hiện thực tiêu chí đó.
- Một tiêu chí KHÔNG ĐẠT (FAIL) CHỈ khi có bằng chứng rõ ràng rằng tiêu chí KHÔNG được thỏa mãn (vd: thiếu endpoint, logic sai, trả sai status code).
- Nếu không đủ bằng chứng để xác minh chắc chắn, hãy đánh dấu PASS (benefit of the doubt) thay vì FAIL.
- overall = PASS nếu tất cả tiêu chí PASS, FAIL chỉ nếu có ít nhất 1 tiêu chí FAIL rõ ràng.
- Trả về CHỈ JSON hợp lệ, không có markdown fence, theo cấu trúc:
{"criteria":[{"criterion":"AC1","verdict":"PASS","reason":"một câu tiếng Việt"}],"overall":"PASS","summary":"một câu tiếng Việt"}`;}

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

async function checkRequirement(req, diff, fileContents) {
  if (!hasLlm()) {
    return { criteria: [], overall: 'UNCHECKED', summary: 'LLM not configured (LLM_API_KEY missing)' };
  }
  const truncated = diff.length > 6000 ? diff.slice(0, 6000) + '\n... (cắt bớt)' : diff;
  try {
    const raw = await callLLM(buildPrompt(req, truncated, fileContents));
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

function buildStandardizePrompt(content) {
  return `Bạn là một chuyên gia phân tích yêu cầu phần mềm. Nhiệm vụ: chuẩn hóa tài liệu URD markdown bằng cách SINH acceptance criteria (AC) tự động cho mỗi yêu cầu.

URD hiện tại (có thể đơn giản, thiếu AC):
\`\`\`markdown
${content}
\`\`\`

Hướng dẫn:
- Đọc từng yêu cầu (### REQ-xxx hoặc ### CR-xxx) trong URD.
- Với mỗi yêu cầu, SINH 2-5 acceptance criteria cụ thể, có thể kiểm tra được (status code, giá trị trả về, hành vi rõ ràng).
- Nếu người dùng đã khai báo exception/message, dùng chúng để tạo AC liên quan (vd: "Trùng code trả 409 Conflict").
- Giữ nguyên frontmatter, tiêu đề, mô tả của mỗi yêu cầu.
- Thêm phần **Acceptance Criteria:** dưới mỗi yêu cầu nếu chưa có.
- Nếu yêu cầu đã có AC, giữ nguyên và bổ sung nếu thiếu.
- Trả về TOÀN BỘ URD markdown đã chuẩn hóa (đầy đủ frontmatter + tất cả yêu cầu + AC).
- KHÔNG thêm markdown fence (\`\`\`) quanh kết quả. Trả về markdown thuần.`;
}

async function standardizeUrd(content) {
  if (!hasLlm()) {
    return { error: 'LLM chưa cấu hình', content: null };
  }
  const truncated = content.length > 6000 ? content.slice(0, 6000) + '\n... (cắt bớt)' : content;
  try {
    const raw = await callLLM(buildStandardizePrompt(truncated));
    let text = raw.trim();
    const fence = text.match(/```(?:markdown)?\s*([\s\S]*?)```/);
    if (fence) text = fence[1].trim();
    return { content: text, error: null };
  } catch (e) {
    return { error: 'LLM lỗi: ' + e.message, content: null };
  }
}

module.exports = { checkRequirement, hasLlm, llmConfig, reviewUrd, standardizeUrd };
