# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Confirmed: React with Vite for the client, Express for the HTTP API, and SQLite for persistent storage. The deployment target is the existing Debian 12 server at htyz.space, behind Nginx.

## Users

- Current students of Huitong No. 1 Middle School who want to share campus information, ask questions, and contribute writing or images.
- Graduates who want to share experience and answer current students' questions.
- Approved campus and alumni administrators who manage published posts and publish authorized campus news.

## Product Purpose

htyz.space is a student-and-alumni community for useful, respectful exchange. It should make publishing, asking, answering, and post-publication safety management clear without collecting unrelated personal information.

## Positioning

The product connects current students and graduates through contributions and question-and-answer threads that publish immediately; administrators can remove violations and ban abusive accounts afterward.

## Operating Context

- Visitors see the homepage; community channels require registration or login.
- Logged-in users submit text, images, and bounded MP4/WebM video; ask questions, answer questions, send product suggestions, and exchange text-only private messages.
- Staff use a separate portal for browsing and deleting posts, banning accounts, news publishing, administrator applications, and audit history. Super administrators additionally review private messages, reset credentials, and remove accounts.
- The super administrator approves staff applications. Approved applicants receive a randomly generated initial password by email and must change it at first login.

## Capabilities and Constraints

- Email and password registration without email verification; registration also requires current-student or graduate identity and a grade/status. Existing accounts must complete their grade/status before browsing community channels. Administrator applications require a separate email-verification step.
- Browser login persists for at most 60 days and then expires absolutely.
- SQLite-backed users, sessions, email tokens, contributions, images, news, questions, answers, suggestions, staff applications, staff accounts, moderation actions, and audit events.
- Text and image contributions, moments, wall posts, questions, and answers publish immediately; contributions, moments, wall posts, and staff news can include one MP4/WebM video of at most 50 MB. Uploads show progress, and staff can later delete posts and ban accounts.
- Authors may archive their own published moments, wall posts (including anonymous ones), contributions, questions, and answers. Other members can still comment and like visible posts but cannot archive them; campus news remains staff-managed.
- All public post types (including news and answers) support comments and reversible likes; comments publish immediately and can be removed by their authors or staff. In-app notifications cover others' likes and comments on a user's own posts, with unread and read states.
- The campus wall alone supports standalone single-choice polls with 2–8 options. Each active account can vote once without changing its choice; the API omits all vote totals and percentages for that account until it votes. Results show aggregate counts and percentages but never voter identities. Polls reuse wall comments, likes, author deletion, and staff moderation.
- Campus news can be published only by active campus staff or a super administrator.
- Current students and graduates may both ask and answer; their roles are labeled on questions and answers.
- Public author identities link to a profile and carry a grade/status badge. A user directory exposes only username, avatar, and grade/status, not email. Anonymous wall posts hide public author identity; the checkbox starts off for a new post, while its author remains anonymous in replies.
- Private chats retain sender, recipient, text, send time, and read time. Only participants can access their conversation through ordinary endpoints; super administrators may review, retain, or clear message text for safety. This access is disclosed in the privacy rules. Passwords are irreversibly hashed and cannot be listed, including for super administrators; a super administrator can instead generate a one-time replacement password and revoke existing sessions.
- The staff overview shows a 14-day daily post curve from real database records, using China Standard Time.
- Administrator applications collect only the specifically required eligibility fields, are access-controlled, and are eligible for automatic deletion after the review retention window.
- No fabricated users, posts, statistics, testimonials, questions, answers, or news are allowed in the product or database.
- SMTP delivery requires valid credentials and must fail explicitly when unavailable; the UI must not claim an email was sent when it was not.
- The existing AstrBot, Xray, and Tailscale services on the host are outside scope and must remain untouched.

## Brand Commitments

- Product name: 会同一中学生社区中心（域名 htyz.space）。
- Chinese primary language.
- The experience must not resemble a traditional blue-and-white school portal or generic card dashboard.
- Motion should feel smooth and purposeful, with reduced-motion support.
- The supplied Foldcraft prompt is inspiration for immersive composition and restrained typography only; its brand, copy, and exact layout must not be copied.

## Evidence on Hand

- Domain and HTTPS are live at htyz.space.
- Production statistics and public content are read from the real database; no synthetic seed records are used.
- No school logo, official photography, testimonials, or approved campus content has been supplied. The product must use honest empty states instead of invented content.
- Site owner contact supplied by the user: QQ 3281895433.

## Product Principles

1. Real data or an honest empty state—never invented community activity.
2. Privacy by minimization: collect only what a workflow truly needs and publish none of it by default.
3. Post-publication safety actions are recorded decisions, not decorative badges.
4. Hidden URLs are not security; every staff action also requires authentication, role checks, CSRF protection, validation, and audit logging.
5. The small server should remain dependable through a lightweight stack and bounded uploads, queries, and background work.

JPEG/PNG files may receive bounded lossless optimization when tools are present. MP4/WebM rewrapping is optional and preserves encoded streams; optimization can never guarantee a smaller file. The original is kept if an optimizer fails or grows the file.

## Accessibility & Inclusion

Keyboard access, visible focus, semantic landmarks, clear form errors, sufficient contrast, responsive layouts, and `prefers-reduced-motion` support are required. Content policy enforcement must not treat ordinary disagreement, requests for help, or constructive criticism as automatically harmful.
