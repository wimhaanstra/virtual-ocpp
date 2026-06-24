# Communication Filter Overhaul Design

## Problem

The communication page currently uses one `communicationFilters` object for form edits, active API queries, export, purge, and live-update refreshes. Because every field edit updates that shared object immediately, partial date/time edits and stale values can affect unrelated refreshes. Live updates and manual refreshes can then reload the journal with filters the operator did not intend to apply.

The page also only fetches the newest fixed-size result set. Operators need a cleaner way to keep filtering while browsing older rows, preferably with endless scrolling.

## Goals

- Filters apply automatically when they change, without an explicit Apply button.
- Date/time filtering is stable and cannot trigger requests with half-edited invalid values.
- Filters survive refresh, back, forward, and copy/paste links through URL query parameters.
- Live communication rows are evaluated against the active filters before the visible list changes.
- The journal supports endless scrolling over older rows.
- Export and purge use the same active filter semantics as the visible journal.
- Backend filter parsing is shared and stricter across list, export, and purge.

## Non-Goals

- Full-text search inside payload JSON.
- Persisted saved filter presets.
- Virtualized table rendering. Endless scrolling is enough for this slice.
- Changing journal retention behavior.
- Changing payload redaction rules.

## Current Context

- Frontend page: `apps/web/src/components/CommunicationView.tsx`
- App state and handlers: `apps/web/src/App.tsx`
- Query builders: `apps/web/src/app-helpers.ts`
- Backend routes: `apps/server/src/communication-journal-routes.ts`
- Backend service: `apps/server/src/communication-journal.ts`
- Current list defaults: last 24 hours, newest first, limit 200.
- Current live event for journal rows only includes summary metadata, not the full row payload.

## Approved Approach

Use URL-backed filter state, debounced automatic filter application, and cursor-based endless scrolling.

### Rejected Alternatives

- **Manual Apply button**: predictable but explicitly rejected; operators want filters to apply when changed.
- **Session storage**: survives refresh but does not support links, browser history, or dashboard deep links as well as URL parameters.
- **Offset pagination**: simple but unstable when new rows are inserted while browsing.

## URL State

The communication page URL is the source of truth for active filters:

- `chargerId`
- `from`
- `to`
- `sourceType`
- `sourceId`
- `targetType`
- `targetId`
- `proxyTargetId`
- `method`
- `type`
- `transactionId`
- `preset`

The UI may keep short-lived draft input state for custom date/time fields, but only validated values are written to the URL. API requests are built from the URL-normalized active filters, not raw input text.

Example:

```text
/communication?chargerId=8881&preset=1h&method=Heartbeat&type=call
```

For custom time ranges, `from` and `to` are ISO strings. The form displays them as local `datetime-local` values.

## Filter Application

- Most controls update the URL immediately.
- Text inputs update after a debounce of roughly `400 ms`.
- Empty values remove their query parameter.
- Invalid custom date ranges do not update the URL and do not trigger a fetch.
- If `from > to`, the UI shows an inline validation message and keeps showing the previous valid result set.
- Reset clears all communication filters except the current page path and charger context if the operator is scoped to a charger.

## Time Presets

The time filter supports:

- `15m`
- `1h`
- `6h`
- `24h`
- `custom`

When no time filter is present, the backend still defaults to the last 24 hours. The frontend should normally write `preset=24h` for clarity after the communication page is opened or reset.

Preset ranges are evaluated at request time, not stored as fixed timestamps. Custom ranges use fixed `from` and `to`.

## Backend API

`GET /api/communication-journal` gains cursor pagination:

Query:

- existing filter fields
- `limit`, default `100`, max `500`
- `cursor`, opaque string returned by the previous response

Response:

```ts
{
  items: CommunicationJournalItem[];
  retentionHours: number;
  nextCursor: string | null;
  hasMore: boolean;
}
```

Ordering must be stable:

```text
createdAt desc, id desc
```

The cursor encodes the last row's `createdAt` and `id`. A request with a cursor returns rows older than that row.

Export keeps its larger max limit and does not use the endless-scroll cursor. Purge never uses the cursor.

## Shared Backend Filter Parsing

List, export, and purge should use one shared normalizer that:

- trims strings
- converts empty strings to `undefined`
- strictly parses dates
- validates `from <= to`
- validates `transactionId` as an integer
- applies the default 24-hour range only for list/export when no explicit range or preset is provided
- requires at least one explicit non-limit filter for filtered purge

## Live Updates

When `journal.recorded` arrives:

1. Check whether the event metadata is enough to evaluate active filters.
2. If it does not match, do nothing.
3. If it matches, fetch or insert the new row at the top.
4. Avoid reloading older pages or resetting scroll position.

Implementation preference:

- Extend the `journal.recorded` live event with enough metadata to match filters:
  - `createdAt`
  - `direction`
  - `sourceType`
  - `sourceId`
  - `targetType`
  - `targetId`
  - `chargerId`
  - `proxyTargetId`
  - `messageType`
  - `ocppMethod`
  - `transactionId`
- If the event matches, fetch the first page with a small limit or fetch the row by id if a row endpoint is added.

For this slice, fetching the first page and merging new rows is acceptable. It is simpler and avoids adding a row-detail endpoint.

The communication view should handle `journal.recorded` separately from the broad `loadScopedData` path. A matching journal event must not trigger reloads of every scoped dashboard resource, and it must not clear currently loaded older journal pages.

## Endless Scrolling

Frontend state should track:

- loaded rows
- `nextCursor`
- `hasMore`
- `loadingInitial`
- `loadingMore`
- `activeFilters`
- any validation error

Flow:

1. Initial load fetches the first page for current URL filters.
2. Scrolling near the bottom fetches `cursor=nextCursor`.
3. Older rows append to the current list.
4. New matching live rows prepend to the list.
5. Changing filters resets loaded rows and cursor, then fetches a fresh first page.

Use `IntersectionObserver` for the bottom sentinel. Keep a button fallback for environments where observer setup fails.

## UI Design

The communication page should use a compact filter bar above the table:

- Time preset segmented/select control
- Method text input
- Message type select
- Transaction text input
- Compact advanced toggle or popover for source/target/proxy fields
- Reset button
- Export and purge actions near the table controls

The result header should show:

- loaded row count
- active filter chips
- validation errors
- loading-more state

Active filter chips should be removable where practical.

## Export And Purge Semantics

- Export uses the current URL-normalized active filters, not draft field text.
- Filtered purge uses the same active filters and still requires confirmation.
- Retention purge is unchanged.
- The purge confirmation modal should display active filters, not draft filters.

## Testing Strategy

Backend tests:

- invalid dates return `400`
- `from > to` returns `400`
- cursor returns older rows in stable order
- `hasMore` and `nextCursor` are correct
- export uses the shared filters
- filtered purge still rejects empty explicit filter scopes

Frontend tests or focused component tests:

- date input edits do not fetch until valid/debounced
- URL query params initialize filters
- changing filters updates URL and reloads first page
- reset clears filters
- loading more appends rows
- matching live events refresh/prepend without clearing the current list
- non-matching live events do not change visible rows

Manual verification:

- Filter by method while live charger traffic arrives.
- Use custom date range and verify no unexpected reset occurs.
- Refresh browser and confirm filters survive.
- Use back/forward after filter changes.
- Scroll to older rows and confirm no duplicates.

## Acceptance Criteria

- No Apply button is needed for communication filters.
- Filter changes update results automatically after debounce/validation.
- Invalid custom date ranges do not issue journal API requests.
- Refreshing `/communication?...` restores the same filters.
- Browser back/forward restores previous communication filter states.
- New live rows only appear when they match the current filters.
- Endless scrolling loads older rows without replacing current rows.
- Export and filtered purge use the same active filters shown by the UI.
- Backend list/export/purge filter parsing has one shared implementation.

## Risks And Mitigations

- **URL can become noisy**: keep parameter names short and omit defaults where possible.
- **Live matching can drift from backend filtering**: centralize frontend filter normalization and keep live matching conservative; refetch the first page if uncertain.
- **Cursor bugs can duplicate rows**: use stable `createdAt desc, id desc` ordering and deduplicate by row id on the frontend.
- **Date timezone confusion**: display local date/time in inputs, send ISO strings to the backend, and show formatted active chips using the app time-format preference.
