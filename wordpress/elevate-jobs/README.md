# ELEVATE Jobs (WordPress plugin)

Shows the open jobs from ELEVATE on your WordPress site, so a job opened, edited or closed in ELEVATE appears on the site within a few minutes.

- The list is read from ELEVATE's public job feed (`/api/careers/jobs`), by the WordPress server, and kept for 2 minutes.
- "Read more and apply" opens the job on ELEVATE. The consent, the resume upload and the spam limits stay there, so **no applicant data ever passes through WordPress**.
- Only the job title, place, pay note, a short summary and the link are shown. If ELEVATE cannot be reached, the last good list is shown for up to a day, then a link to the careers page.

## Install

1. Zip the folder `elevate-jobs` (the zip must contain the folder, with `elevate-jobs.php` inside).
2. In WordPress: Plugins, Add New, Upload Plugin, choose the zip, Install, Activate.
3. Settings, ELEVATE Jobs: enter the address of your ELEVATE site (for example `https://elevate.yourcompany.com`, starting with https, nothing after the domain). Save.
4. Edit any page and add the shortcode `[elevate_jobs]`.

Options: `[elevate_jobs limit="5" summary="no"]` shows at most 5 jobs without the short description.

## Look

The default style is plain and light. To match your theme, style `.elevate-jobs`, `.elevate-job`, `.elevate-job-title`, `.elevate-job-meta`, `.elevate-job-summary` and `.elevate-job-button` from your theme's CSS.

## ELEVATE side (nothing is needed for this plugin)

The plugin reads the feed from the server, so no browser permission is needed. Two optional settings in ELEVATE's environment (Vercel), both comma separated website addresses:

- `CAREERS_FEED_ALLOWED_ORIGINS`: sites whose visitors' browsers may read the feed directly (only if you write your own script instead of using this plugin).
- `CAREERS_EMBED_ORIGINS`: sites allowed to show ELEVATE's careers page in a frame (an `<iframe>`). Leave empty and framing is refused.

## If it does not show

- "Open positions are listed at ..." appears when ELEVATE could not be reached and there is no saved list: check the address in the settings and open `<address>/api/careers/jobs` in a browser; it should show a list of jobs.
- A job missing from the list is not open in ELEVATE (a draft, closed or archived job is never shown).
- Wait 2 to 3 minutes after a change in ELEVATE (the site keeps the list for 2 minutes, and ELEVATE's network cache keeps it for up to a minute).
