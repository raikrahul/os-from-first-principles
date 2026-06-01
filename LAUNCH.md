# Launch Checklist

This repo is ready to publish as a static GitHub Pages site.

## Before first push

1. Replace placeholder URLs in:
   - `robots.txt`
   - `sitemap.xml`
   - optional canonical tags if you add them later
2. Choose the repo name. Suggested:
   - `os-from-first-principles`
   - `operating-systems-from-first-principles`
3. Review `CONTENT_LICENSE.md` and decide if non-commercial content terms match
   the publishing plan.

## Publish

```bash
cd /home/r/Desktop/study/interview_systems/mit_os_course/os-blog
git init
git add .
git commit -m "Publish OS from first principles"
gh repo create os-from-first-principles --public --source=. --push
```

Then in GitHub:

- Settings -> Pages -> Source: GitHub Actions.
- The workflow `.github/workflows/pages.yml` deploys on every push to `main`.

## Share copy

Plain launch post:

```text
I made the OS course I wanted while doing xv6.

No lecture fog.
No "descriptor ring" before you can draw the row.
Every lesson starts with concrete state, one blank, one trap, one test.

Start with the E1000 driver or the user-thread switch.
```

Short post:

```text
Operating Systems From First Principles:
cells, rows, traps, and tests before jargon.
Built from local xv6 lab work.
```

## What makes it spread

- Show the diagrams, not opinions.
- Post one gotcha at a time.
- Link each gotcha to the lesson.
- Keep the claim narrow: "this helps you do the lab", not "this replaces OS courses".
