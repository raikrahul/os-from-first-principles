# Operating Systems From First Principles

Static course/blog site for OS lessons in the user's fill-in-the-blank style.

## Run locally

Open `index.html` in a browser.

No install step. No build step.

## Deploy with GitHub Pages

One simple path:

```bash
git init
git add .
git commit -m "Initial OS course blog"
gh repo create os-from-first-principles --public --source=. --push
gh api repos/:owner/os-from-first-principles/pages \
  --method POST \
  -f source.branch=main \
  -f source.path=/
```

If the repo already exists, push this folder to it and enable Pages for the `main`
branch root.

## Source style

- Start with concrete machine state.
- Ask one blank at a time.
- Explain the wrong answer by exact failure.
- Name standard terms only after the mechanism is visible.
- End with proof: local test, transcript, or invariant.

## Course sources used

- Local xv6 notes in `mit_os_course/notes/`.
- Existing user thread and E1000 lesson material in `topics/`.
- Verified net lab transcript: `nettests` passed with 111 echoed packets.

## Local code coverage

The assignments are backed by local code:

- `labs/xv6-new`: combined working tree with hand-built code through net.
- `labs/xv6-labs-2021`: official branch scaffolds and graders for util,
  syscall, pgtbl, traps, cow, thread, net, lock, fs, mmap.
- `labs/xv6-new/notxv6`: host-side pthread programs for the thread lab.

Current caveat: `labs/xv6-new` is a dirty combined tree. Use
`labs/xv6-labs-2021` branches for clean assignment starts and graders.
