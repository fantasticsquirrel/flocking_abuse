# Flocking Abuse Tracker

A planned simple public webpage and data workflow for tracking reported abuses, misuses, legal challenges, and policy failures involving Flock Safety / flock camera systems.

This repository is currently in **planning-first** stage. The implementation plan is in:

- [`docs/plans/2026-07-30-flocking-abuse-tracker.md`](docs/plans/2026-07-30-flocking-abuse-tracker.md)

## Core goals

- Maintain a source-grounded catalog of reported flock camera abuse incidents.
- Use a consistent report format with strong source requirements.
- Provide a password-only manual admin entry flow modeled after the Hermes WebUI style: one shared admin password, no username, no public signup, secrets never committed.
- Add daily automated discovery through a Hermes cron job that loads a dedicated skill, searches the web, deduplicates candidates, and opens reviewable additions rather than silently publishing weak claims.

## Important non-goals for MVP

- No unverified allegations in the public dataset.
- No collection of private victim information beyond what reliable public sources already report.
- No scraping that ignores robots.txt, paywalls, or site terms.
- No automatic publication of new accusations without review unless the source and uniqueness checks pass strict gates defined in the plan.
