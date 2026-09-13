# Jarvis — Hướng dẫn sử dụng

> AI agent kiểm tra commit against URD, sinh tài liệu, quản lý nhiều dự án.

## 1. Tổng quan

Jarvis là agent đọc **URD** (User Requirements Document, định dạng markdown) và **source code** trong git repo, dùng **LLM** (z-ai/glm-5.2-hackathon) để kiểm tra xem mỗi commit có thỏa mãn tiêu chí chấp nhận (acceptance criteria) trong URD hay không.

**Tính năng chính:**
- Kiểm tra commit bằng LLM (phân tích diff + nội dung file đầy đủ vs acceptance criteria)
- Chuẩn hóa URD: sinh Acceptance Criteria tự động từ yêu cầu đơn giản
- Review URD bằng LLM (chấm điểm, điểm mạnh/yếu, gợi ý)
- Sinh tài liệu sử dụng từ source code (overview, user guide, API reference, developer guide)
- Quản lý nhiều dự án, mỗi dự án có URD repo riêng
- Upload URD mới, xem/download URD gốc
- Chặn trước (pre-commit hook) hoặc kiểm tra sau (post-commit)
- Quét toàn bộ commit (scan-all) hoặc kiểm tra commit gần nhất
- Traceability matrix: bản đồ yêu cầu ↔ code ↔ commit ↔ test
- Coverage dashboard: % yêu cầu PASS/FAIL/chưa bắt đầu + xu hướng
- Impact analysis: URD thay đổi ảnh hưởng code nào
- Hướng dẫn sử dụng tích hợp (nút ❓)

## 2. Giao diện

### 2.1. Sidebar — Quản lý dự án

| Phần | Chức năng |
|------|-----------|
| **Danh sách dự án** | Click chọn dự án. Hiển thị số yêu cầu (yc), chế độ kiểm tra (⚙), link GitHub (🔗) |
| **➕ Thêm dự án** | Mở modal thêm dự án mới (đường dẫn local hoặc clone từ Git) |
| **✏️ (hover)** | Sửa thông tin dự án (đường dẫn, URD path, git URL, chế độ kiểm tra) |
| **✕ (hover)** | Xóa dự án khỏi Jarvis |

### 2.2. Header

| Nút | Chức năng |
|----|-----------|
| **Kiểm tra commit** | Chạy LLM check 3 commit gần nhất, tự chuyển sang tab Commit |
| **Quét toàn bộ** | Quét tất cả commit có claim REQ (async, chạy nền), tự chuyển sang tab Commit |
| **Sinh tài liệu** | Sinh markdown từ source code, tự chuyển sang tab Tài liệu |
| **Làm mới** | Tải lại dữ liệu |
| **❓ Hướng dẫn** | Mở modal hướng dẫn sử dụng (markdown render) |

### 2.3. Thanh cài đặt

Hiện khi chọn dự án:
- **Chế độ kiểm tra**: Kiểm tra sau / Chặn trước / Cả 2
- **📥 Tải hook**: Tải script `commit-msg` cho pre-commit mode
- **Trạng thái quét**: ✓ đã quét full / chưa quét full

### 2.4. Các tab

#### Tab "Yêu cầu"
- **📤 Tải lên URD mới**: 3 nút:
  - **✨ Chuẩn hóa URD** — sinh Acceptance Criteria tự động từ REQ đơn giản
  - **Review bằng LLM** — chấm điểm chất lượng URD (điểm, điểm mạnh/yếu, gợi ý)
  - **Tải lên** — lưu file URD, tự sync yêu cầu mới
- **📁 URD gốc**: list file URD, xem/download markdown gốc
- **Yêu cầu**: group theo URD, mỗi yêu cầu hiển thị tiêu chí chấp nhận, commit liên kết, ghi chú không khớp

#### Tab "Commit"
- Mỗi commit hiển thị: verdict PASS/FAIL, claimed REQ-IDs
- Mỗi yêu cầu: verdict + summary + per-AC (✅/❌ + lý do bằng tiếng Việt)
- Ghi chú: missing-requirement, no-claim, requirement-not-satisfied

#### Tab "Tài liệu"
- **Sinh tài liệu** tạo 5 file markdown:
  - `overview.md` — tổng quan, tính năng, quick start
  - `user-guide.md` — hướng dẫn sử dụng cho người dùng (curl examples + AC)
  - `api-reference.md` — API endpoints + modules + functions
  - `developer-guide.md` — kiến trúc, module, cách mở rộng
  - `index.md` — mục lục
- Click file → đọc markdown render

#### Tab "Bản đồ" (Traceability Matrix)
- Bảng map: Yêu cầu ↔ URD ↔ Commit ↔ Source ↔ Test
- Commit badge: xanh (PASS) / đỏ (FAIL)
- Trạng thái: PASS / FAIL / chưa bắt đầu
- Test files: tự quét nội dung file test tìm REQ-ID (`*Test.java`, `*.test.js`, `*.spec.ts`)

#### Tab "Sức khỏe" (Coverage)
- Donut chart % coverage
- Số liệu: PASS / FAIL / chưa bắt đầu
- Phân tích theo URD
- Xu hướng coverage theo commit (bar chart)
- Coverage dựa trên **per-requirement verdict** (không phải commit-level ok)

#### Tab "Tác động" (Impact Analysis)
- Lịch sử thay đổi URD (recent commits trong URD repo)
- Mỗi URD file → yêu cầu + source files ảnh hưởng + trạng thái (OK / có FAIL / đang làm / chưa code)

## 3. Định dạng URD

URD là file markdown với YAML frontmatter:

```markdown
---
id: URD-001
title: Tên tính năng
version: 1.0.0
status: active
---

# URD-001: Tên tính năng

### REQ-001: Tên yêu cầu
Mô tả yêu cầu.

**Acceptance Criteria:**
- AC1: Tiêu chí 1
- AC2: Tiêu chí 2
```

**Quy ước:**
- ID yêu cầu: `REQ-xxx` (tính năng mới) hoặc `CR-xxx` (change request — sửa)
- Mỗi yêu cầu nên có **Acceptance Criteria** cụ thể, có thể kiểm tra
- AC mô tả: status code, giá trị trả về, hành vi rõ ràng
- URD có thể ở cùng repo source hoặc **repo riêng**
- Nếu chưa có AC, dùng nút **✨ Chuẩn hóa URD** để LLM sinh tự động

### Acceptance Criteria (AC) là gì?

AC là các tiêu chí kiểm tra để xác nhận yêu cầu đã được hiện thực đúng. Jarvis dùng AC để kiểm tra commit:

1. Developer commit code, ghi `Req: REQ-001` trong message
2. Jarvis lấy diff + nội dung file + AC → gửi cho LLM
3. LLM xem từng AC: code có thỏa mãn không?
4. Verdict: **PASS** (tất cả AC đạt) hoặc **FAIL** (có AC không đạt)

## 4. Workflow

### 4.1. Viết URD

**Cách 1: Viết đầy đủ (có AC)**
```markdown
### REQ-001: Tạo tài sản mới
POST /api/assets tạo tài sản với name, code, purchaseValue.

**Acceptance Criteria:**
- AC1: POST hợp lệ trả 201 + id tự sinh
- AC2: Thiếu name/code trả 400
- AC3: Trùng code trả 409 Conflict
```

**Cách 2: Viết đơn giản → chuẩn hóa bằng LLM**
```markdown
### REQ-001: Tạo tài sản mới
POST /api/assets tạo tài sản với name, code, purchaseValue.
Exception: trùng code trả 409, thiếu field trả 400.
```
→ Bấm **✨ Chuẩn hóa URD** → LLM sinh AC tự động → review → **Tải lên**

### 4.2. Kiểm tra sau (post-commit) — mặc định

1. Developer commit code với message chứa `Req: REQ-001, REQ-002`
2. Mở dashboard → bấm **Kiểm tra commit** (3 commit gần nhất) hoặc **Quét toàn bộ**
3. Jarvis lấy diff + nội dung file + URD → LLM phân tích → verdict PASS/FAIL per AC
4. Xem kết quả ở tab **Commit**

### 4.3. Chặn trước (pre-commit)

1. Đổi chế độ sang **Chặn trước** hoặc **Cả 2**
2. Bấm **📥 Tải hook** → tải file `commit-msg`
3. Cài hook:
   ```bash
   cp commit-msg .git/hooks/commit-msg
   chmod +x .git/hooks/commit-msg
   ```
4. Khi commit, hook tự gọi Jarvis API:
   - **PASS** → commit thành công
   - **FAIL** → chặn commit, hiện lý do
   - Bỏ qua: `git commit --no-verify`

### 4.4. Thêm dự án mới

**Từ đường dẫn local:**
1. Bấm **➕ Thêm dự án** → chọn "Đường dẫn local"
2. Nhập tên + đường dẫn source + (tùy chọn) đường dẫn URD
3. Chọn chế độ kiểm tra → **Thêm dự án**

**Clone từ Git:**
1. Bấm **➕ Thêm dự án** → chọn "Clone từ Git"
2. Nhập tên + Git URL source + (tùy chọn) Git URL URD
3. Jarvis tự clone repo → thêm dự án

### 4.5. Sửa dự án

1. Hover project trong sidebar → bấm **✏️**
2. Sửa đường dẫn, URD path, git URL, chế độ kiểm tra
3. Bấm **Lưu thay đổi**

### 4.6. Upload + Chuẩn hóa URD

1. Tab **Yêu cầu** → mục **📤 Tải lên URD mới**
2. Dán URD markdown vào textarea (có thể đơn giản, chỉ có REQ tiêu đề)
3. Bấm **✨ Chuẩn hóa URD** → LLM sinh AC tự động → nội dung cập nhật trong textarea
4. Bấm **Review bằng LLM** → xem đánh giá chất lượng (điểm, điểm mạnh/yếu, gợi ý)
5. Bấm **Tải lên** → lưu file, tự sync yêu cầu mới

### 4.7. Sinh tài liệu

1. Chọn dự án → bấm **Sinh tài liệu**
2. Tab **Tài liệu** → chọn file để đọc
3. Tài liệu sinh từ URD (tính năng, AC) + source code (modules, functions)

### 4.8. Quét toàn bộ commit

1. Bấm **Quét toàn bộ** ở header
2. Jarvis quét tất cả commit có claim REQ (async, chạy nền)
3. Tab **Commit** hiển thị kết quả dần dần
4. Trạng thái quét: ✓ đã quét full / chưa quét full (trong thanh cài đặt)

## 5. API

| Method | Endpoint | Chức năng |
|--------|----------|-----------|
| GET | `/api/projects` | Danh sách dự án |
| POST | `/api/projects` | Thêm dự án (local) |
| POST | `/api/projects/clone` | Thêm dự án (clone Git) |
| PATCH | `/api/projects/:name/mode` | Sửa dự án |
| DELETE | `/api/projects/:name` | Xóa dự án |
| GET | `/api/projects/:name/hook` | Tải pre-commit hook |
| GET | `/api/registry?project=` | Dữ liệu đầy đủ (yêu cầu + commit) |
| GET | `/api/urd?project=` | List file URD |
| GET | `/api/urd/:file?project=` | Đọc URD markdown |
| POST | `/api/urd?project=` | Upload URD mới |
| POST | `/api/urd/review?project=` | Review URD bằng LLM |
| POST | `/api/urd/standardize?project=` | Chuẩn hóa URD — sinh AC tự động |
| POST | `/api/check/recent?project=` | Kiểm tra commit gần nhất |
| POST | `/api/check/all?project=` | Quét toàn bộ commit (async) |
| POST | `/api/check/staged?project=` | Kiểm tra staged diff (pre-commit) |
| POST | `/api/generate-docs?project=` | Sinh tài liệu |
| GET | `/api/docs?project=` | List tài liệu đã sinh |
| GET | `/api/docs/:file?project=` | Đọc tài liệu |
| GET | `/api/traceability?project=` | Traceability matrix |
| GET | `/api/coverage?project=` | Coverage dashboard |
| GET | `/api/impact?project=` | Impact analysis |
| GET | `/api/guide` | Hướng dẫn sử dụng (markdown) |
| GET | `/health` | Health check |

## 6. Triển khai

Jarvis deploy trên GreenNode AgentBase:
- Runtime: Docker image (Node.js 18 + git)
- LLM: z-ai/glm-5.2-hackathon qua GreenNode AI Platform
- Port 8080, health check `/health`
- Bootstrap: tự check tất cả commit có claim REQ khi khởi động
- Mọi tài liệu dưới dạng markdown
