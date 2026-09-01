# Draft order container: professional desktop layout

Status: approved enhancement (2026-08-30)

## User outcome

As a league manager, I can scan the Draft order quickly on desktop without a
long Team name colliding with its draft slot or moving the Autodraft control.
The same row remains legible at narrower widths, in dark theme, and with
keyboard or assistive-technology navigation.

## Problem observed

The desktop Draft rail is approximately one-third of the workspace. Its rows
use a wrapping flex layout in `DraftRail.jsx`; long Team names wrap beneath the
number, while the MUI `Switch` and its label occupy variable-width space beside
the Team identity. The result is uneven control alignment and a visibly cubed,
offset toggle treatment.

## Approved design

Each Draft order row is a three-column grid:

```text
| draft slot | Team identity and status                | Autodraft |
|-----------:|------------------------------------------|----------:|
|        10. | Keep my team name out yo mouth   [You]   |   [pill]  |
```

- Draft slot is a fixed-width, muted column. It never participates in name
  wrapping.
- Team identity is the flexible column with `min-width: 0`. The Team name is
  one line with ellipsis; the full name remains available through a tooltip and
  an accessible name. The row never wraps beneath the slot.
- `You` and `On the clock` remain attached to the Team identity. `AUTO` remains
  the enabled-state indicator for rows whose viewer cannot control Autodraft.
- Autodraft is a fixed, right-aligned action column. The existing accessible
  switch semantics and `Autodraft for {teamName}` label remain unchanged.
- The switch is restyled as a compact pill: rounded track, circular thumb,
  stable checked/unchecked contrast from design tokens, and no label-placement
  offset. The accessible switch remains a fixed, right-aligned action without
  adding a redundant visible row label.
- The row uses the same structure at every breakpoint. Mobile may reduce
  spacing, but it does not revert to wrapping flex rows.

## FSD slice

This is a local FSD island, not a repo-wide folder migration:

```text
src/widgets/draft-order/
  ui/DraftOrderPanel.jsx

src/features/autodraft-toggle/
  ui/AutodraftToggle.jsx
```

`DraftRail` remains the existing page composition point. It decides when Draft
order is present; `DraftOrderPanel` owns the ordered Team presentation and row
layout; `AutodraftToggle` owns only the accessible control presentation and its
change callback. The widget exposes a small public interface; its internal
`embedded` prop is used only when the same list is placed inside `Upcoming`:

```text
DraftOrderPanel({
  teams,
  draftStatus,
  viewerTeamId,
  isCommissioner,
  onTheClock,
  onToggleAutodraft,
})
```

The widget continues to derive order through the existing `teamsInDraftOrder`
contract. No endpoint, socket payload, Team identity, permission rule, or
Autodraft side effect changes.

## Preserved behavior

- Draft slot numbering and snake-order derivation remain unchanged.
- Team identity remains `teamId`/`teamName`; manager usernames are not added to
  the container.
- A manager may control Autodraft for their own Team; the commissioner may
  control every Team while the Draft is not complete.
- Pending and active Draft compositions keep their existing visibility rules.
- Existing accessible labels, `AUTO` state, `You` marker, on-clock marker,
  queue behavior, and `data-testid` contracts remain intact.

## Acceptance criteria

1. A Team name of at least 50 characters never renders below or beside the
   draft slot; it truncates within the Team column and exposes its full value
   on hover/focus and to assistive technology.
2. Every Autodraft label and switch shares one vertical, right-aligned action
   column at desktop widths from 1024px through 1440px.
3. Checked and unchecked switches have pill-shaped tracks and circular thumbs;
   no switch is rendered as a square or is offset by the Team name length.
4. `You`, `AUTO`, and `On the clock` remain visually distinguishable without
   relying on color alone.
5. Keyboard focus reaches each Autodraft control in Draft order, with the full
   Team name and control purpose available to assistive technology.
6. The layout passes light and dark theme checks and remains readable when the
   rail's independent scroll region is active.
7. Focused tests cover long names, duplicate Team names, disabled controls,
   checked Autodraft, the viewer marker, and the on-clock row. Browser QA
   captures narrow and wide desktop screenshots plus one mobile regression.

## Non-goals

- No change to Draft order, rotation, Autodraft policy, Draft endpoints, or
  socket events.
- No manager username or account identity in the Draft order container.
- No repo-wide migration of existing `src/components` into FSD layers.
- No changes to the Draft board matrix, player pool, queue, or chat.
