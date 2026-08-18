import React from "react";

const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export function IconClock(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  );
}

export function IconLock(props) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M7.5 11V7.5a4.5 4.5 0 0 1 9 0V11" />
    </svg>
  );
}

export function IconHourglass(props) {
  return (
    <svg {...base} {...props}>
      <path d="M6 3h12" />
      <path d="M6 21h12" />
      <path d="M7 3v3.6a4 4 0 0 0 1.6 3.2l1.9 1.4a1 1 0 0 1 0 1.6l-1.9 1.4A4 4 0 0 0 7 17.4V21" />
      <path d="M17 3v3.6a4 4 0 0 1-1.6 3.2l-1.9 1.4a1 1 0 0 0 0 1.6l1.9 1.4a4 4 0 0 1 1.6 3.2V21" />
    </svg>
  );
}

export function IconCheckCircle(props) {
  return (
    <svg {...base} {...props}>
      <path d="M21 11.1V12a9 9 0 1 1-5.3-8.2" />
      <polyline points="21 4 12 13.01 9 10.01" />
    </svg>
  );
}

export function IconUpload(props) {
  return (
    <svg {...base} {...props}>
      <path d="M8 15l4-4 4 4" />
      <path d="M12 11v9" />
      <path d="M19.4 17.4A4.5 4.5 0 0 0 17 9h-1.1a7 7 0 1 0-11.7 6.4" />
    </svg>
  );
}
