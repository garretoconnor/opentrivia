# Game Studio UX review and remediation plan

Reviewed October 11, 2026 against the local preview and current source. This is a heuristic review, not a user study or a completed accessibility audit. No application changes were made for this review.

## Walkthrough

Inspected the existing two-round game: standard board, clue editor with an attached image, cancellation, Boss round selection, Export menu, Play setup, and Back. Checked the narrow viewport and restored the original round and browser size afterward. Did not publish, import, delete, resize, or change saved content. Destructive and publishing behaviors below were inspected in source, not exercised against the saved game.

## Findings

| Priority | Finding and evidence | Effect |
| --- | --- | --- |
| P0 | The clue dialog's × has no `type="button"`; the form submit handler saves without checking the submitter. See `index.html` and `modules/studio.js`. | Closing can save edits when a user expects dismissal. |
| P0 | Round deletion immediately splices and saves. Reducing dimensions truncates columns/clues and saves immediately (`modules/studio.js`, `core.mjs`). No confirmation or undo is provided. | Easy loss of authored content through compact controls. |
| P1 | `.editor-board` has an unconditional 680px minimum width. Both the two-column standard board and one-card Boss board overflow on the desktop preview. On the phone check, the container was about 245px wide. | Unnecessary horizontal scrolling and clipped content even for very small rounds. |
| P1 | Game settings, cover image, and round navigation occupy a 285px rail beside the app rail. On mobile, this whole panel stacks above the editor; the workspace began about 925px below the document top in a 767px-tall viewport. | The main authoring task is crowded on desktop and absent from the first phone screen. |
| P1 | Editor cards show only point values and tiny status dots. The Boss card says only “Edit clue.” | Authors must open cards to understand or audit their content. Completion is hard to scan. |
| P1 | Most surfaces use gradients, gloss, shadows, rounded containers, and heavy type simultaneously. Small labels compete with a large display heading; yellow values sit on bright blue tiles. | Weak hierarchy and tiring reading. This is a visual assessment; contrast ratios have not yet been measured. |
| P1 | The clue dialog scrolls as one large surface. With the attached image, Save and Cancel sit below the visible area. | The completion action disappears while editing; image decoration consumes too much working space. |
| P2 | Metadata autosaves immediately, while clue edits require Save. “Saved on this device” appears low in the settings rail and is static. | The saving model is unclear; unsaved clue text can be mistaken for saved content. |
| P2 | Play enters player setup rather than offering a lightweight author preview. Setup shows both Back and Exit game. Publish directly submits in source without a review step. | Testing content takes unnecessary steps; public publishing lacks a clear review boundary. |
| P2 | Round names derive from the first topic; round buttons override their native button role with `role="listitem"`. “Board,” “round,” “card,” and “clue” mix across actions. | Navigation meaning is inconsistent visually and for assistive technology. |

## Design direction

Keep Frutiger Aero in the app shell, logo, navigation selection, and a small number of primary actions. Use opaque, quiet surfaces for authoring: dark text, restrained borders, minimal shadows, and normal-weight editable text. Preserve the three font roles; reserve display type for short headings and monospace for numeric values. Do not solve this by adding another layer of CSS overrides: consolidate the Studio-specific rules.

The default Studio surface should be organized around writing clues:

- A compact document toolbar: game title, real save status, Game settings, Preview, and Publish. Put Import/Export under a secondary menu.
- A compact round selector with explicit round numbers, optional names, completion counts, and one Add round menu. Keep round deletion in the round menu.
- The selected round's content, with editable topics and cards that show point value, a short clue excerpt, and a text/icon completion state.
- A clue editor with a persistent action area and a small, expandable image attachment preview.

On narrow screens, show the title, round selector, and first topic's clues before secondary metadata. Use a topic selector and vertical clue list instead of squeezing the desktop board into a narrow viewport. Game settings should open separately rather than precede the entire editor.

## Delivery sequence

### 1. Fix behavior that can lose or unexpectedly save work

- Make ×, Cancel, and Escape consistent dismissal paths. If a card is dirty, offer explicit discard/keep-editing behavior. Save must be the only committing action.
- Before shrinking a populated board, show how many authored clues would be removed. Provide undo for round deletion and dimension reductions.
- Make dirty, saving, saved, and failed states truthful. Handle local storage failures without claiming success.
- Restore native button semantics in round navigation; label the clue dialog with its visible title.

Acceptance: dismissing never silently saves; destructive changes can be recovered; keyboard focus returns to the originating card; save failures remain visible. Add focused regression tests for these behaviors.

### 2. Rebuild the authoring hierarchy and responsive layout

- Replace the always-open metadata rail with Game settings; elevate the round selector.
- Remove the fixed board minimum width. Size standard topic columns by available editor space, allowing contained overflow only for genuinely large boards.
- Render a Boss round as one normal-width clue panel, not an oversized game tile.
- Use the compact toolbar and a mobile topic/list layout described above.

Acceptance: one- and two-topic boards and Boss rounds fit without horizontal scrolling; a common five-topic board fits at a desktop width; large boards scroll inside the editor only. At 360–390px, a user reaches a clue from the initial screen without scrolling through settings.

### 3. Make content readable and fast to edit

- Replace ornamental board tiles with light authoring cards, readable excerpts, and explicit Empty/Needs response/Complete states.
- Reduce title size and weight; use consistent body/control sizing and spacing. Keep Aero gloss as an accent.
- Keep Save/Cancel visible independently of dialog content scrolling. Collapse image previews by default when space is limited.
- Add Save and next to support sequential authoring, with clear topic/point context and predictable keyboard focus.

Acceptance: authors can locate incomplete clues without opening each card; long topics and clues remain legible; attached images never hide the save actions. Verify text contrast against the actual rendered surfaces, keyboard focus visibility, reduced motion, and 200% zoom.

### 4. Clarify testing and publishing

- Add an author Preview that can inspect a clue/round without player-name setup; keep actual Play as a separate action.
- Add a publish review with title, cover, completion summary, and a clear public-sharing action.
- Standardize terminology: Game → Round → Topic → Clue. Explain Boss wagering where it is relevant.

Acceptance: previewing preserves the selected round and draft; publication requires a deliberate final action; reviewers can jump directly from incomplete-content warnings to the relevant clue.

## Validation before rollout

Exercise empty and populated drafts, one/two/five/many-topic rounds, Boss rounds, long labels, image attachments, cancel/save/discard, resize/delete/undo, storage failure, preview return, and publishing review. Check desktop and phone layouts, keyboard-only navigation, focus return, zoom, and reduced motion. Use disposable test data for destructive paths. Re-run existing tests and the asset build; add behavior tests for the P0 fixes rather than tests that merely mirror CSS.

Recommended scope for the first implementation: steps 1–3 together. They address correctness, the cramped layout, and the illegibility; step 4 can follow separately.


## Implementation status

Implemented October 11, 2026: document toolbar and settings dialog; compact round navigation with completion counts; responsive topic cards with clue excerpts; mobile topic selector; persistent clue-dialog actions and collapsed attachments; discard protection; resize/delete confirmation and single-step undo (available until the next edit); storage failure feedback; Save & next; author preview; and publishing review with links to incomplete clues. Studio styles are isolated in `studio.css`.

Validation: 33 automated tests pass, including five new editor regression tests covering dismissal, sequential save, storage failure, shrink/undo, and delete/undo. Browser checks verified original clue content survived discard, preview and publishing review opened correctly, and the 390px layout had no page overflow with the first clue accessible in the initial viewport. Public submission was not exercised. A full accessibility audit remains outside this pass.
