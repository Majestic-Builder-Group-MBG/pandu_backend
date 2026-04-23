# BE-1 - Pandu Backend Technical Analysis

OK, all files (excluding ignored directories) have been fully read and analyzed.

## Scope

This document analyzes the valid source files in the workspace, excluding `node_modules/` and `storage/` as requested. The `storage/` tree is treated as runtime data for uploads and generated artifacts, not as source code.

## System Architecture

Pandu Backend is a layered monolithic Express API. The runtime starts in `server.js`, loads environment settings, initializes MySQL schema state, mounts feature routers, and then starts a reminder dispatcher loop. Business logic is split across controllers and service objects, while cross-cutting concerns such as authentication, role checks, rate limiting, file uploads, and pagination are handled by middleware and utilities.

The system integrates with four main external domains:

* MySQL for persistent application state.
* Optional Redis for rate limiting.
* The local filesystem for uploaded module, session, and quiz assets.
* External delivery APIs for OpenRouter AI and Web Push notifications.

```mermaid
flowchart TB
  Client[Client / Admin / Teacher / Student] -->|HTTP| Server[server.js / Express app]

  Server --> AuthRoutes[/api/auth]
  Server --> ModuleRoutes[/api/modules]
  Server --> EnrollmentRoutes[/api/enrollments]
  Server --> DashboardRoutes[/api/dashboard]
  Server --> ReminderRoutes[/api/reminders]
  Server --> PushRoutes[/api/push]
  Server --> PublicRoutes[/public]
  Server --> Docs[index.html at /]

  AuthRoutes --> AuthController[authController]
  AuthRoutes --> RegistrationCodeController[registrationCodeController]
  ModuleRoutes --> ModuleController[moduleController]
  ModuleRoutes --> QuizController[quizController]
  ModuleRoutes --> ReminderController[reminderController]
  EnrollmentRoutes --> EnrollmentController[enrollmentController]
  DashboardRoutes --> DashboardController[dashboardController]
  ReminderRoutes --> ReminderController
  PushRoutes --> PushSubscriptionController[pushSubscriptionController]
  PublicRoutes --> ModuleController

  AuthController --> RegistrationCodeService[registrationCodeService]
  AuthController --> TokenSecurityService[tokenSecurityService]
  RegistrationCodeController --> RegistrationCodeService
  ModuleController --> ModuleAccessService[moduleAccessService]
  ModuleController --> ModuleStorageService[moduleStorageService]
  ModuleController --> SessionContentService[sessionContentService]
  ModuleController --> SessionContentViewTokenService[sessionContentViewTokenService]
  QuizController --> QuizAccessService[quizAccessService]
  QuizController --> QuizAttemptService[quizAttemptService]
  QuizController --> QuizStatsService[quizStatsService]
  QuizController --> QuizValueService[quizValueService]
  QuizController --> QuizStorageService[quizStorageService]
  QuizController --> QuizDraftAiService[quizDraftAiService]
  ReminderController --> DB[(MySQL)]
  ReminderDispatcher[reminderDispatcherService] --> DB
  ReminderDispatcher --> PushService[pushService]

  AuthMiddleware[authMiddleware] --> TokenSecurityService
  RateLimiter[rateLimitMiddleware] --> Redis[(Redis optional)]

  AuthController --> DB
  RegistrationCodeService --> DB
  ModuleController --> DB
  EnrollmentController --> DB
  DashboardController --> DB
  ReminderController --> DB
  PushSubscriptionController --> DB
  QuizAttemptService --> DB
  QuizStatsService --> DB
  QuizDraftAiService --> OpenRouter[OpenRouter API]
  PushService --> WebPush[Web Push / VAPID]
  ModuleStorageService --> Storage[(filesystem storage/)]
  QuizStorageService --> Storage
```

## Project Structure

### Root

* `server.js` is the application entry point. It loads dotenv, initializes MySQL schema state, mounts feature routers, serves `index.html` at `/`, and starts the reminder dispatcher.
* `index.html` is a built-in documentation page for the API. It is not part of the backend runtime logic, but it documents routes, payloads, and example flows.
* `package.json` defines the Node.js runtime shape, the `start` and `dev` scripts, and the dependency set used by the API.
* `package-lock.json` pins the exact dependency graph, including Express 5, MySQL2, JWT, bcryptjs, multer, Redis client support, pdf parsing, and web push.
* `.env` carries runtime configuration such as database connection values, JWT secrets, OpenRouter credentials, VAPID keys, Redis settings, and server port/bind address. It also reveals that sensitive values are currently stored in the workspace file itself.
* `.gitignore` excludes `node_modules` and `storage`, which matches the runtime-data separation used by the code.

### `config/`

* `db.js` creates the MySQL connection pool and verifies the database connection during startup.
* `initDb.js` creates and evolves the schema. It is effectively an application-start migration bootstrap with table creation, foreign keys, indexes, and several defensive `ALTER TABLE` statements.
* `redis.js` decides whether Redis is active, builds the client options, and exposes the optional client used by rate limiting.

### `controllers/`

* `authController.js` handles registration, login, and logout.
* `registrationCodeController.js` manages code creation, listing, revocation, summary, usage history, and cleanup of expired codes.
* `moduleController.js` is the largest controller. It handles module CRUD, default session creation, session scheduling, session content CRUD, banner downloads, public file view URLs, and file downloads.
* `enrollmentController.js` handles student enrollment by module key and listing the current student enrollment set.
* `dashboardController.js` returns upcoming sessions with role-aware visibility.
* `reminderController.js` manages session reminders and the student reminder listing.
* `pushSubscriptionController.js` stores, deletes, and lists browser push subscriptions.
* `quizController.js` manages quiz creation, update, publish state, question CRUD, media downloads, AI draft generation, student attempts, grading, leaderboard visibility, and attempt deletion.

### `middleware/`

* `authMiddleware.js` validates Bearer JWTs and rejects revoked tokens.
* `rateLimitMiddleware.js` implements Redis-backed or in-memory rate limiting for auth and registration code creation.
* `roleMiddleware.js` guards routes by role.
* `uploadMiddleware.js` configures multer temporary file storage, mime-type filtering, and file size limits.

### `routes/`

* `authRoutes.js` exposes authentication and registration-code endpoints.
* `moduleRoutes.js` exposes modules, sessions, content, reminders, quiz authoring, quiz attempts, and leaderboard endpoints under a single feature namespace.
* `enrollmentRoutes.js` exposes enrollment and the student enrollment list.
* `dashboardRoutes.js` exposes the upcoming sessions dashboard.
* `reminderRoutes.js` exposes the student reminder list.
* `pushRoutes.js` exposes push subscription CRUD.
* `publicRoutes.js` exposes the token-based public file view route.

### `services/`

* `registrationCodeService.js` contains all registration-code business rules and database operations.
* `tokenSecurityService.js` hashes and revokes auth tokens, then cleans expired blacklist entries.
* `sessionContentViewTokenService.js` signs and verifies short-lived public-view tokens.
* `pushService.js` initializes Web Push from VAPID settings and sends notifications.
* `reminderDispatcherService.js` polls due reminders, inserts in-app notifications, and optionally sends push notifications.
* `ai/quizDraftAiService.js` fetches session context, extracts text from PDF content, prompts OpenRouter, validates AI output, and can apply the generated draft to the quiz tables.
* `module/moduleAccessService.js` centralizes module read/manage checks and session lock logic.
* `module/moduleStorageService.js` owns module/session storage path translation and safe file movement.
* `module/sessionContentService.js` formats session content responses and determines file-kind behavior.
* `quiz/quizAccessService.js` centralizes quiz read/manage checks and student access assertions.
* `quiz/quizAttemptService.js` runs the attempt lifecycle, scoring, essay review, leaderboard, and deletion logic.
* `quiz/quizStatsService.js` calculates quiz health and student attempt summaries.
* `quiz/quizStorageService.js` owns quiz file path translation and safe file movement.
* `quiz/quizValueService.js` normalizes booleans, numbers, JSON fields, and MCQ options.

### `utils/`

* `listResponse.js` standardizes pagination meta output across list endpoints.

## Dependency and Flow Analysis

### Boot Sequence

1. `server.js` loads dotenv and builds the Express app.
2. Global middleware is attached: CORS, JSON parsing, and URL-encoded form parsing.
3. Feature routers are mounted under `/api/auth`, `/api/modules`, `/api/enrollments`, `/api/dashboard`, `/api/reminders`, `/api/push`, and `/public`.
4. The root route serves `index.html`.
5. `initializeDatabase()` runs schema creation and schema drift fixes before the server starts listening.
6. After the HTTP server is live, `reminderDispatcherService.start()` begins the periodic reminder loop.

### Authentication and Authorization Flow

* Registration and login accept `text/plain` bodies that must contain valid JSON. That is a deliberate compatibility choice in `authRoutes.js` and `authController.js`.
* Registration requires `name`, `email`, `password`, and `registration_code`. The final user role is not trusted from the request body; it is derived from the target role stored on the registration code.
* Registration is transactional. The code row is locked, the user row is inserted, and usage count is incremented before commit.
* Login uses bcrypt password comparison and returns a JWT with `id`, `email`, and `role` claims.
* Logout hashes the presented token and stores it in `revoked_auth_tokens`. `authMiddleware.js` checks every Bearer token against that blacklist after JWT verification.
* `roleMiddleware.js` provides coarse role gating, while the service layer performs ownership checks for teacher-owned resources.

### Module, Session, and Content Flow

* Creating a module inserts a `modules` row, then seeds three default sessions. If a banner is uploaded, it is moved from temp storage into `storage/modules/{moduleId}/banner`.
* Module access is role-aware. Admins can do everything, teachers can manage their own modules, and students can only read enrolled modules.
* Modules return `capabilities` fields so the frontend can render actions without guessing permissions.
* Session scheduling is tracked with `open_at`. Students are blocked from reading future-dated sessions until the scheduled time.
* Session content supports `file`, `url`, and `text` types. Files are moved into `storage/modules/{moduleId}/sessions/{sessionId}` and mapped back to relative paths for persistence.
* Session content responses are enriched with `file_download_url`, `file_kind`, `is_media`, and public-view support flags by `sessionContentService.js`.
* Public file views use short-lived JWT tokens from `sessionContentViewTokenService.js`. Non-image and non-video files can be rendered inline without a Bearer token through `/public/session-contents/view`.

### Enrollment and Dashboard Flow

* Students enroll with an `enroll_key`. The key is normalized to uppercase, looked up on the module table, and inserted into `module_enrollments` if the student is not already enrolled.
* The dashboard query is role-aware. Admins see all upcoming sessions, teachers see only their sessions, and students see sessions from their enrollments.
* Dashboard items include whether a quiz exists and whether it is published, which lets the UI surface upcoming learning actions.

### Quiz Lifecycle

* A quiz is scoped to a single session. The code and schema enforce a one-quiz-per-session model.
* Teachers can create, update, publish, and delete quizzes and quiz questions. Banner and question media use the quiz storage subtree.
* MCQ validation is strict: at least two options, at least one correct option, and consistent sorting.
* Quiz access is blocked for students until the parent session opens and the quiz is published.
* Student attempts are stateful. `startAttempt()` either resumes a live attempt or creates a new one until the max-attempt limit is exhausted.
* Submission auto-grades MCQ answers, stores attempt answers, and marks quizzes with essays as `submitted_pending_review` until teacher review completes.
* Essay review requires all essay questions in an attempt to be graded in one pass. The scoring model stores both raw point totals and percent-based score fields.
* Leaderboards support `latest`, `best`, and `all` views. Public leaderboard visibility must be explicitly enabled by the teacher or admin.

### Reminder and Push Flow

* Student reminders are stored per session and per user, with a simple `in_app` channel model.
* `reminderDispatcherService.js` runs on a timer and scans for reminders whose `open_at` window is active. It inserts in-app notifications and optionally delivers browser push notifications.
* Push subscriptions are deduplicated by endpoint hash. Invalid push endpoints can be removed automatically when the push response indicates a gone or not-found state.

### Data Model Observations

The startup schema in `initDb.js` suggests the following core tables and relationships:

* `users` with roles `admin`, `teacher`, and `student`.
* `modules` owned by teachers.
* `module_sessions` belonging to modules and optionally scheduled with `open_at`.
* `module_enrollments` linking students to modules.
* `session_contents` storing file, URL, and text content.
* `session_quizzes`, `quiz_questions`, and `quiz_question_options` for quiz authoring.
* `quiz_attempts` and `quiz_attempt_answers` for student assessment state and grading data.
* `session_reminders` and `in_app_notifications` for reminder delivery.
* `push_subscriptions` for browser push delivery.
* `registration_codes` and `registration_code_usages` for onboarding control.
* `revoked_auth_tokens` for logout and token invalidation.

## System Understanding

### Architecture Style

The codebase is a single-process, layered backend monolith. It is not a microservice system. The main boundaries are:

* HTTP routing.
* Controller orchestration.
* Service-layer business logic.
* Database and filesystem persistence.
* External AI and push integrations.

### Design Patterns Observed

* Service objects encapsulate reusable domain rules.
* Route-level middleware handles coarse authorization and upload parsing.
* Transactional writes protect multi-step state changes such as registration, quiz attempts, and AI quiz replacement.
* Response shaping is normalized through helper objects such as `buildListResponse()` and the session/quiz response builders.
* File storage paths are abstracted through storage services instead of being hardcoded in controllers.

### Strengths

* The role model is explicit and consistently enforced.
* The schema is relational and uses foreign keys and indexes instead of ad hoc JSON blobs for core data.
* The quiz attempt engine stores both raw points and percent fields, which makes auditing easier.
* Token revocation exists, so logout is real rather than cosmetic.
* The reminder and push pipeline is already automated end to end.

### Weaknesses

* Several controllers are large and do too much, especially `moduleController.js` and `quizController.js`.
* Schema evolution is handled by startup-time DDL rather than a dedicated migration system.
* Some list endpoints fetch all rows and then paginate in memory, which will not scale well.
* The code depends on external services for AI draft generation and push delivery, so behavior is partly network-bound.
* Sensitive environment values are stored in the workspace `.env` file, which is a deployment and security risk.

## Requirements Analysis

### Functional Requirements

* Users must be able to register and log in with email/password.
* Registration must be controlled by a registration code whose target role determines the final account role.
* Admins and teachers must be able to issue, revoke, summarize, archive, and delete registration codes.
* Teachers and admins must be able to create modules, sessions, and content assets.
* Students must be able to enroll using a module enroll key.
* Students must only see module content that they are allowed to access, and session access must respect the `open_at` schedule.
* Teachers and admins must be able to create quizzes, add MCQ and essay questions, upload media, publish quizzes, and change leaderboard visibility.
* Students must be able to start and submit quiz attempts, with automatic scoring for MCQ answers.
* Teachers and admins must be able to review essay questions and finalize attempt scores.
* Students must be able to subscribe to in-app reminders and push notifications for upcoming sessions.
* The backend must expose public file-view URLs for allowed file types without requiring a Bearer token.
* The dashboard must return upcoming sessions with a role-aware scope.
* List endpoints must return standardized pagination metadata.

### Non-Functional Requirements

* Authentication must support token revocation.
* Sensitive actions must be role-checked and, where necessary, ownership-checked.
* File uploads must be limited in size and filtered by mime type.
* The system should survive Redis unavailability by falling back to in-memory rate limiting.
* MySQL operations that span multiple writes should be transactional.
* AI quiz generation should fail safely when external context is missing or unsupported.
* The system should keep file paths normalized and safe across platforms.
* Notification dispatch should avoid duplicate reminder inserts and should remove dead push subscriptions.

### Likely User Flows

* Admin or teacher logs in, creates a registration code, and shares it with a new user.
* New user registers using the code and receives the role dictated by that code.
* Teacher creates a module, gets a generated enroll key, and the system creates three starter sessions.
* Teacher schedules sessions, uploads content, and optionally generates a quiz draft from session materials.
* Student enrolls using the module key, then studies content, opens allowed files through the normal route or a public token, and starts quiz attempts when the session opens.
* Teacher reviews essay answers, publishes final scores, and can optionally open the leaderboard.
* Student subscribes to reminders and push notifications for upcoming sessions.

### Assumptions Inferred From Code

* The application is intended for an LMS or training platform rather than a general content site.
* One quiz belongs to one session, and one session belongs to one module.
* Teachers own modules, while admins have global oversight.
* Students are consumers and cannot author learning content.
* Public file access is intentionally limited to non-image, non-video files.
* OpenRouter is the selected AI provider, not a local model.

## Development Timeline Plan

### Phase 1: Setup and Core Foundation, 1 to 2 weeks

* Harden configuration management.
* Replace startup schema bootstrapping with explicit migrations.
* Validate auth, token revocation, RBAC, and rate limiting.
* Stabilize database and storage helper behavior.

### Phase 2: Feature Development, 3 to 5 weeks

* Complete module, session, and content workflows.
* Finish quiz authoring, attempt, review, and leaderboard paths.
* Implement reminder and push subscription UX and API integration.
* Add AI draft generation workflows and fallback handling.

### Phase 3: Optimization, 1 to 2 weeks

* Move heavy list queries to SQL pagination.
* Split large controllers into smaller service-focused units.
* Add background job hardening for reminder dispatch.
* Improve logging, error categorization, and dead-file cleanup.

### Phase 4: Deployment, 1 week

* Rotate secrets out of the workspace `.env` file.
* Validate MySQL and Redis production settings.
* Run smoke tests for auth, module access, quiz flow, and reminder dispatch.
* Configure backup, observability, and deployment rollbacks.

## Technical Risks and Improvements

### High Priority Risks

* Secrets are stored directly in `.env`. Those values should be moved to a secure secret manager and rotated.
* Startup DDL in `initDb.js` makes production behavior depend on application startup. A real migration tool would be safer and more auditable.
* `Math.random()` is still used for registration-code generation. `crypto.randomInt()` would be a stronger choice.
* `regenerateEnrollKey()` does not recheck uniqueness after generation, so a rare collision could slip through.
* The reminder dispatcher polls on an interval. That is acceptable early on, but it will become noisy and expensive at scale.

### Scalability Concerns

* List endpoints fetch all rows first and then paginate in memory, which will not scale for large module, attempt, or reminder tables.
* Quiz leaderboard ranking is also computed after loading all graded attempts for the quiz.
* File access checks rely on repeated joins and path resolution; indexes help, but the flow should be measured under load.
* Redis fallback is process-local when Redis is unavailable, so multi-instance deployments will have inconsistent rate limits.

### Maintainability Concerns

* `moduleController.js` and `quizController.js` are too large and should be split into narrower handlers or services.
* There is duplication between module access checks and quiz access checks.
* Several validation rules are hand-written in controllers instead of being centralized in a request schema layer.
* Error handling is mostly consistent, but some branches return generic 500 responses that hide the actionable root cause.

### Suggested Improvements

* Introduce SQL pagination and filtering for list endpoints.
* Add migration tooling and stop mutating schema on startup.
* Replace in-process scheduler logic with a queue or cron worker if reminder volume grows.
* Add tests for quiz scoring, leaderboard visibility, token revocation, file cleanup, and public-view token expiry.
* Add a uniqueness-safe loop for enroll-key regeneration.
* Centralize request validation for auth, module, quiz, and reminder payloads.

## Final Notes

The backend is already coherent and feature-rich for an LMS-style product. Its biggest strengths are the clear role model, transactional write paths, and the full lifecycle coverage across modules, content, reminders, and quizzes. Its biggest technical debt is operational: schema bootstrapping, secrets handling, large controllers, and in-memory post-query pagination will all need attention before the system is comfortable at a larger scale.