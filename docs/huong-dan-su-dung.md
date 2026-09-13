# Jarvis — Hướng dẫn sử dụng

> AI agent kiểm tra commit against URD, sinh tài liệu, quản lý nhiều dự án.

## 1. Tổng quan

Jarvis là agent đọc **URD** (User Requirements Document, định dạng markdown) và **source code** trong git repo, dùng **LLM** (z-ai/glm-5.2-hackathon) để kiểm tra xem mỗi commit có thỏa mãn tiêu chí chấp nhận (acceptance criteria) trong URD hay không.

**Tính năng chính:**
- Kiểm tra commit bằng LLM (phân tích diff vs acceptance criteria)
- Sinh tài liệu sử dụng từ source code (overview, user guide, API reference, developer guide)
- Quản lý nhiều dự án, mỗi dự án có URD repo riêng
- Upload + review URD mới bằng LLM
- Chặn trước (pre-commit) hoặc kiểm tra sau (post-commit)
- Traceability matrix, coverage dashboard, impact analysis

## 2. Giao diện

### 2.1. Sidebar — Quản lý dự án

| Phần | Chức năng |
|------|-----------|
| **Danh sách dự án** | Click chọn dự án. Mỗi dự án hiển thị số yêu cầu (yc), chế độ kiểm tra (⚙), link GitHub (🔗) |
| **➕ Thêm dự án** | Mở modal thêm dự án mới (đường dẫn local hoặc clone từ Git) |
| **✏️ (hover)** | Sửa thông tin dự án (đường dẫn, URD path, git URL, chế độ kiểm tra) |
| **✕ (hover)** | Xóa dự án khỏi Jarvis |

### 2.2. Header

| Nút | Chức năng |
|----|-----------|
| **Kiểm tra commit** | Chạy LLM check 3 commit gần nhất, tự chuyển sang tab Commit |
| **Sinh tài liệu** | Sinh markdown từ source code, tự chuyển sang tab Tài liệu |
| **Làm mới** | Tải lại dữ liệu |

### 2.3. Thanh cài đặt

Hiện khi chọn dự án:
- **Chế độ kiểm tra**: Kiểm tra sau / Chặn trước / Cả 2
- **📥 Tải hook**: Tải script `commit-msg` cho pre-commit mode

### 2.4. Các tab

#### Tab "Yêu cầu"
- **📤 Tải lên URD mới**: dán markdown → Review bằng LLM → Tải lên
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
- Trạng thái: PASS / FAIL / chưa bắt đầu
- Test files: tự quét `*Test.java`, `*.test.js`, `*.spec.ts`

#### Tab "Sức khỏe" (Coverage)
- Donut chart % coverage
- Số liệu: PASS / FAIL / chưa bắt đầu
- Phân tích theo URD
- Xu hướng coverage theo commit (bar chart)

#### Tab "Tác động" (Impact Analysis)
- Lịch sử thay đổi URD (recent commits trong URD repo)
- Mỗi URD file → yêu cầu + source files ảnh hưởng + trạng thái

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
- Mỗi yêu cầu phải có **Acceptance Criteria** cụ thể, có thể kiểm tra
- URD có thể ở cùng repo source hoặc **repo riêng**

## 4. Workflow

### 4.1. Kiểm tra sau (post-commit) — mặc định

1. Developer commit code với message chứa `Req: REQ-001, REQ-002`
2. Mở dashboard → bấm **Kiểm tra commit**
3. Jarvis lấy diff + URD → LLM phân tích → verdict PASS/FAIL per AC
4. Xem kết quả ở tab **Commit**

### 4.2. Chặn trước (pre-commit)

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

### 4.3. Thêm dự án mới

**Từ đường dẫn local:**
1. Bấm **➕ Thêm dự án** → chọn "Đường dẫn local"
2. Nhập tên + đường dẫn source + (tùy chọn) đường dẫn URD
3. Chọn chế độ kiểm tra → **Thêm dự án**

**Clone từ Git:**
1. Bấm **➕ Thêm dự án** → chọn "Clone từ Git"
2. Nhập tên + Git URL source + (tùy chọn) Git URL URD
3. Jarvis tự clone repo → thêm dự án

### 4.4. Upload URD mới

1. Tab **Yêu cầu** → mục **📤 Tải lên URD mới**
2. Dán nội dung URD markdown vào textarea
3. Nhập tên file (vd: `urd-005-export.md`)
4. Bấm **Review bằng LLM** → xem đánh giá chất lượng (điểm, điểm mạnh/yếu, gợi ý)
5. Bấm **Tải lên** → lưu file, tự sync yêu cầu mới

### 4.5. Sinh tài liệu

1. Chọn dự án → bấm **Sinh tài liệu**
2. Tab **Tài liệu** → chọn file để đọc
3. Tài liệu sinh từ URD (tính năng, AC) + source code (modules, functions)

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
| POST | `/api/check/recent?project=` | Kiểm tra commit gần nhất |
| POST | `/api/check/staged?project=` | Kiểm tra staged diff (pre-commit) |
| POST | `/api/generate-docs?project=` | Sinh tài liệu |
| GET | `/api/docs?project=` | List tài liệu đã sinh |
| GET | `/api/docs/:file?project=` | Đọc tài liệu |
| GET | `/api/traceability?project=` | Traceability matrix |
| GET | `/api/coverage?project=` | Coverage dashboard |
| GET | `/api/impact?project=` | Impact analysis |
| GET | `/health` | Health check |

## 6. Triển khai

Jarvis deploy trên GreenNode AgentBase:
- Runtime: Docker image (Node.js 18 + git)
- LLM: z-ai/glm-5.2-hackathon qua GreenNode AI Platform
- Port 8080, health check `/health`
- Mọi tài liệu dưới dạng markdown
