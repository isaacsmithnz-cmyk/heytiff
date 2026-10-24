"use client";

import type { KeyboardEvent } from "react";
import { Icon } from "@/components/shell/icon";
import { IconButton } from "./button";
import { TextInput, type ControlSize } from "./field";

/* A SEARCH BOX: the magnifying glass inside its left edge, the words, and
   a clear cross once there are some (rule 27: clear is an icon). One box
   for every list that narrows as you type, so Jobs, the Schedule's Jobs and
   Design are the same box (Isaac, 25 October 2026: the Schedule's had no
   glass, and changed height with the tabs under it). Esc clears it. */
export function SearchField({
  value,
  onChange,
  label,
  placeholder = label,
  size = 36,
  className,
}: {
  value: string;
  onChange: (words: string) => void;
  /** what it searches, as a screen reader hears it: "Search jobs, clients and sites" */
  label: string;
  placeholder?: string;
  size?: ControlSize;
  className?: string;
}) {
  return (
    <div className={`pt-search${className ? ` ${className}` : ""}`} role="search">
      <span className="pt-search-icon" aria-hidden="true">
        <Icon name="search" size={16} />
      </span>
      <TextInput
        size={size}
        className="pt-search-input"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Escape" && value) onChange("");
        }}
      />
      {value && <IconButton glyph="clear" label="Clear the search box" size={32} className="pt-search-clear" onClick={() => onChange("")} />}
    </div>
  );
}
