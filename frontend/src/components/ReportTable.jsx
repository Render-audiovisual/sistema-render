import React from 'react';

export function ReportTable({ caption, columns, children }) {
  return <div className="rpr-table-wrap rpr-responsive-wrap">
    <table className="rpr-responsive-table" role="table">
      <caption className="rpr-sr-only">{caption}</caption>
      <thead role="rowgroup"><tr role="row">
        {columns.map((column, index) => <th key={index} scope="col" role="columnheader">{column}</th>)}
      </tr></thead>
      <tbody role="rowgroup">{children}</tbody>
    </table>
  </div>;
}

export function ReportCell({ label, children, wide = false }) {
  return <td role="cell" className={wide ? 'rpr-cell-wide' : undefined}>
    <span className="rpr-cell-label" aria-hidden="true">{label}</span>
    <span className="rpr-cell-value">{children}</span>
  </td>;
}
