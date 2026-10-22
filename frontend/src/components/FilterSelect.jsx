import React from 'react';
import './FilterSelect.css';

// React 19 forwards ref as a native prop. Keep values, handlers, options and
// selection semantics owned by the caller; this component is presentation only.
export function FilterSelect({ label, children, className = '', selectClassName = '', ref, ...nativeProps }) {
  return <label className={`render-filter-field${className ? ` ${className}` : ''}`}>
    <span>{label}</span>
    <select {...nativeProps} ref={ref} className={`render-filter-select${selectClassName ? ` ${selectClassName}` : ''}`}>{children}</select>
  </label>;
}
