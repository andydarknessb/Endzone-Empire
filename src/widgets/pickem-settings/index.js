/**
 * Public surface of the pickem-settings widget (#1267, ADR 0038). The page
 * composes `CommissionerPanel` from here; `PICKEM_MODE_OPTIONS` is exported
 * for the two below-page consumers that must read the same scoring-mode
 * copy the panel itself renders (ADR 0038's "What to build" - moved from
 * `src/components/LeaguePickem/PickemSettingsPanel`):
 *
 *   - `src/components/common/LeagueTypeFields.jsx` - the league-type create
 *     dialogs' scoring-mode picker.
 *   - `src/components/LeagueRules/PickemRulesView.jsx` - the read-only rules
 *     page's scoring-mode label.
 *
 * Both are below the island (`src/components`), the same sanctioned
 * below-island edge ADR 0029's amendment already allows for a legacy
 * consumer reaching a named export.
 */
export { default, PICKEM_MODE_OPTIONS } from './ui/CommissionerPanel';
