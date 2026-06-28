import type { ReactNode } from "react";
import { Fragment } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";

export type ExpandableDataTableColumn<T> = {
  key: string;
  header?: ReactNode;
  headerAriaLabel?: string;
  headingClassName?: string;
  cellClassName?: string;
  stopPropagation?: boolean;
  render: (row: T) => ReactNode;
};

type ExpandableDataTableProps<T> = {
  columns: Array<ExpandableDataTableColumn<T>>;
  expandedRowIds: Set<string>;
  getRowDetailsLabel: (row: T) => string;
  getRowId: (row: T) => string;
  onToggleRow: (rowId: string, row: T) => void;
  renderExpandedRow: (row: T) => ReactNode;
  rows: T[];
  tableClassName?: string;
  wrapClassName?: string;
};

export function ExpandableDataTable<T>({
  columns,
  expandedRowIds,
  getRowDetailsLabel,
  getRowId,
  onToggleRow,
  renderExpandedRow,
  rows,
  tableClassName,
  wrapClassName
}: ExpandableDataTableProps<T>) {
  return (
    <div className={["sessions-table-wrap", wrapClassName].filter(Boolean).join(" ")}>
      <table className={["sessions-table", tableClassName].filter(Boolean).join(" ")}>
        <thead>
          <tr>
            <th aria-label="Expand row details" />
            {columns.map((column) => (
              <th key={column.key} className={column.headingClassName} aria-label={column.headerAriaLabel}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rowId = getRowId(row);
            const expanded = expandedRowIds.has(rowId);
            const detailsLabel = getRowDetailsLabel(row);
            const toggle = () => onToggleRow(rowId, row);

            return (
              <Fragment key={rowId}>
                <tr
                  className="session-table-row"
                  tabIndex={0}
                  onClick={toggle}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggle();
                    }
                  }}
                >
                  <td className="session-table-cell session-table-cell--expand">
                    <Button
                      type="button"
                      className="button-secondary icon-button overview-icon-action session-expand-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggle();
                      }}
                      title={expanded ? "Hide details" : "Show details"}
                      aria-label={`${expanded ? "Hide" : "Show"} details for ${detailsLabel}`}
                    >
                      {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                    </Button>
                  </td>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={column.cellClassName}
                      onClick={column.stopPropagation ? (event) => event.stopPropagation() : undefined}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
                {expanded ? (
                  <tr className="session-detail-table-row">
                    <td colSpan={columns.length + 1}>{renderExpandedRow(row)}</td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
