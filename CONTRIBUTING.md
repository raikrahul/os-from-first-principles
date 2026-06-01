# Contributing

This project is for operating systems lessons that make the reader do the work.

## Lesson format

Every new lesson should include:

- A concrete starting state: numbers, rows, cells, registers, or a drawn chunk.
- One fill-in blank at a time.
- The wrong answer and the exact failure it causes.
- The assembled code only after the learner earns it.
- A final grill question with real values.

## Style rules

- Prefer exact state over broad labels.
- Avoid motivational filler.
- Avoid repeated generic jargon before the mechanism is visible.
- Keep public code snippets short and clearly educational.
- Add local proof when possible: test command, output, or branch path.

## Pull request checklist

- `node --check app.js` passes.
- New assignment cards name the local branch or test file backing them.
- New diagrams fit mobile width.
- New content does not copy full third-party lab pages or full solution files.
