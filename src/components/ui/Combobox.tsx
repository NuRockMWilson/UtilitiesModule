"use client";

import { useEffect, useId, useRef, useState } from "react";

export type ComboboxOption = {
  /** Underlying value submitted to the form. */
  value: string;
  /** Primary label shown in the dropdown and (when selected) in the input. */
  label: string;
  /** Optional secondary text shown muted under the label. */
  detail?: string;
  /** Search-only blob — concatenated label + detail + any extra hints. */
  search?: string;
};

interface ComboboxProps {
  name: string;
  options: ComboboxOption[];
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  /** Mono-font for the input. Useful for account numbers and codes. */
  mono?: boolean;
  /** How many filtered results to render at once (perf cap). */
  maxResults?: number;
  className?: string;
}

/**
 * Searchable single-select combobox. Native select is fine for ~20 options
 * but unusable for 600 utility accounts — this gives the user typeahead
 * filtering with arrow-key navigation and Enter to commit.
 *
 * Submits the chosen option's `value` via a hidden input named `name` so
 * it slots into existing FormData-driven server actions without changes.
 *
 * Filtering is case-insensitive substring match against `option.search`
 * (or `label + " " + detail` when `search` isn't supplied).
 */
export function Combobox({
  name,
  options,
  value,
  defaultValue,
  placeholder = "Search…",
  required,
  mono,
  maxResults = 50,
  className = "",
}: ComboboxProps) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Internal selected-value state. We accept a controlled `value` prop or a
  // one-time `defaultValue`; in both cases we resolve to a starting option.
  const [selectedValue, setSelectedValue] = useState<string>(value ?? defaultValue ?? "");
  const [query, setQuery] = useState<string>("");
  const [open, setOpen] = useState<boolean>(false);
  const [activeIdx, setActiveIdx] = useState<number>(0);

  // When prop `value` changes (controlled usage), sync internal state.
  useEffect(() => {
    if (value !== undefined) setSelectedValue(value);
  }, [value]);

  // Render text in the input: when not focused, show selected option's label;
  // when focused, show the user's query.
  const selectedOption = options.find(o => o.value === selectedValue) ?? null;
  const inputDisplay = open ? query : (selectedOption?.label ?? "");

  // Filter options by query.
  const q = query.trim().toLowerCase();
  const filtered = q.length === 0
    ? options.slice(0, maxResults)
    : options
        .filter(o => {
          const blob = (o.search ?? `${o.label} ${o.detail ?? ""}`).toLowerCase();
          return blob.includes(q);
        })
        .slice(0, maxResults);

  // Click outside → close (and revert query).
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    if (open) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function commit(opt: ComboboxOption) {
    setSelectedValue(opt.value);
    setQuery("");
    setOpen(false);
    setActiveIdx(0);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIdx(prev => Math.min(prev + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(prev => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      if (open && filtered[activeIdx]) {
        e.preventDefault();
        commit(filtered[activeIdx]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    } else if (e.key === "Backspace" && !query && selectedValue) {
      // Backspace in empty query clears the selection
      setSelectedValue("");
    }
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <input
        type="text"
        autoComplete="off"
        ref={inputRef}
        value={inputDisplay}
        placeholder={selectedOption ? "" : placeholder}
        onFocus={() => setOpen(true)}
        onChange={e => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIdx(0);
        }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        className={`input w-full pr-8 ${mono ? "font-mono text-[13px]" : ""}`}
      />
      {/* Hidden input is the real form value */}
      <input type="hidden" name={name} value={selectedValue} required={required} />

      {/* Clear / chevron */}
      {selectedValue && !open && (
        <button
          type="button"
          aria-label="Clear selection"
          onMouseDown={e => { e.preventDefault(); setSelectedValue(""); inputRef.current?.focus(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-nurock-slate-light hover:text-nurock-black text-[14px]"
        >
          ×
        </button>
      )}

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-md border border-nurock-border bg-white shadow-lg"
        >
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-[12.5px] text-nurock-slate-light">No matches.</li>
          )}
          {filtered.map((opt, i) => (
            <li
              key={opt.value}
              role="option"
              aria-selected={opt.value === selectedValue}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={e => { e.preventDefault(); commit(opt); }}
              className={`px-3 py-2 cursor-pointer text-[13px] ${
                i === activeIdx ? "bg-[#FAFBFC]" : ""
              } ${opt.value === selectedValue ? "font-medium text-nurock-navy" : "text-nurock-black"}`}
            >
              <div className={mono ? "font-mono text-[12.5px]" : ""}>{opt.label}</div>
              {opt.detail && (
                <div className="text-[11.5px] text-nurock-slate truncate">{opt.detail}</div>
              )}
            </li>
          ))}
          {options.length > maxResults && q.length === 0 && (
            <li className="px-3 py-1.5 text-[11px] text-nurock-slate-light italic border-t border-nurock-border">
              Showing first {maxResults} of {options.length}. Type to search.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
