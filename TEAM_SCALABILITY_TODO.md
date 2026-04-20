# PlanetGen2 Team Scalability & Best Practices To-Do List

This document outlines the gaps in the current setup compared to game development industry best practices, specifically focusing on team scalability, and provides a targeted to-do list to address them.

## Identified Gaps

1. **Missing TypeScript / Type-Safety (Critical):** The documentation assumes TypeScript (`.ts`), but the codebase is vanilla JavaScript (`.js`). This makes collaborating on complex ECS architectures difficult and error-prone.
2. **Asset Pipeline & Git Repo Bloat:** Massive raw binary archives (`.zip`) are checked directly into the repository without tracking, bloating clone times.
3. **Total Lack of Automated Testing:** No testing frameworks exist to prevent regressions when systems interact.
4. **Zero Linting or Formatting Enforcement:** Missing tools like ESLint and Prettier lead to messy, conflict-heavy code diffs in Pull Requests.
5. **"Dead Code" checked into Main:** Disabled core features (like the new `CreatureManager`) are checked in as commented-out code rather than using proper feature flags.

---

## Actionable To-Do List

### Phase 1: DX (Developer Experience) & Standardization 

**1. Implement Code Formatting & Linting (Quick Win)**
- [ ] Run `npm install -D eslint prettier eslint-config-prettier eslint-plugin-prettier`
- [ ] Create `.eslintrc.json` and `.prettierrc` with your team's agreed rule set.
- [ ] Run `npm install -D husky lint-staged` and set up a pre-commit hook to auto-format files on `git commit`.

**2. Migrate from JS to TypeScript (High Impact)**
- [ ] Run `npm install -D typescript @types/three` and generate a `tsconfig.json`.
- [ ] Rename core data schemas (e.g., in `src/ecs/components/`) from `.js` to `.ts` and define explicit interfaces.
- [ ] Incrementally rename `src/` files from `.js` to `.ts`, starting with ECS systems (`world-system`, `vehicle-system`).
- [ ] Update `package.json` scripts to include a CI command: `"typecheck": "tsc --noEmit"`.

### Phase 2: Repository Hygiene

**3. Clean Up Asset Tracking (Git LFS)**
- [ ] Install Git LFS locally (`git lfs install`).
- [ ] Track large assets by running `git lfs track "*.glb"` and `git lfs track "*.zip"`.
- [ ] Create a dedicated `assets/raw/` branch or use a separate central storage logic (like AWS S3 or a shared Drive) for the massive `.zip` files so they aren't actively pulled by every developer on a simple code pull.

**4. Introduce Feature Flags**
- [ ] Create a `config/features.ts` (or `.js`) file containing a simple constants object (e.g., `export const FEATURES = { USE_CREATURES_V3: false };`).
- [ ] Go into `src/world-system.js` (or `.ts`), delete the commented-out creature logic, and wrap the instantiation in your new flag: `if (FEATURES.USE_CREATURES_V3) { this._creatureManager = new CreatureManager(...) }`.

### Phase 3: Reliability

**5. Implement Automated Testing (Vitest)**
- [ ] Since the project is built via Vite, run `npm install -D vitest`.
- [ ] Add a `"test": "vitest run"` script to your `package.json`.
- [ ] Write your first simple unit test for a pure logic file (e.g., create `src/creatures/rng.test.js` or `.ts` to assert that the Mulberry32 logic is generating correct bounds).
- [ ] Begin adding unit tests for any logic that mutates ECS component states to guarantee system stability as the team scales.
