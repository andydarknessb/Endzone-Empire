/**
 * Public surface of the `postgame-cutscene` feature (ADR 0052, spec #1747): the
 * full-screen result a manager sees the first time they open Home after a week
 * is final. Home composes it from this index only.
 *
 *   - `usePostgameCutscenes()` fetches the due list once per mount of the caller
 *     and returns `{ cutscenes }`; a failed fetch is an empty list.
 *   - `PostgameCutscenes` renders nothing for an empty list, and otherwise
 *     lazy-loads the one chunk holding the title card, the queue, the scenes and
 *     (later) the audio.
 *
 * Import edges, for the boundary audit ADR 0020 names: `entities/standings`
 * (the Record string), `shared/lib` (team colors) and `shared/ui` (sprite and
 * avatar), each through its index, plus the sanctioned reach below the island,
 * `src/api/apiClient`. It imports no widget, page, component or other feature.
 */
export { usePostgameCutscenes } from './model/usePostgameCutscenes';
export { default as PostgameCutscenes } from './ui/PostgameCutscenes';
