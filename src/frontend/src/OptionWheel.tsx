import { useEffect, useId, useRef, useState } from "react";
import ReactBitsOptionWheel from "./reactbits/OptionWheel";
import { SpecularButton } from "./SpecularButton";

type Option = { value: string; label: string };

export function OptionWheel({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  useEffect(() => {
    if (open)
      popup.current
        ?.querySelector<HTMLElement>('[role="listbox"]')
        ?.focus({ preventScroll: true });
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const choose = () => {
    close();
  };

  return (
    <div
      className="site-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (!open) return;
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
        if (
          event.key === "Enter" &&
          event.target instanceof HTMLElement &&
          event.target.getAttribute("role") === "listbox"
        ) {
          event.preventDefault();
          choose();
        }
      }}
    >
      <SpecularButton
        ref={trigger}
        className="option-wheel-trigger"
        aria-label={label + ": " + (options[selected]?.label ?? "No sites")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>{options[selected]?.label ?? "No sites"}</span>
        <span className="option-wheel-chevron" aria-hidden="true" />
      </SpecularButton>
      {open && (
        <div ref={popup} className="site-wheel-popup">
          <p className="wheel-hint">Scroll, drag or choose a site</p>
          <div id={id} className="site-wheel-viewport">
            <ReactBitsOptionWheel
              label={label}
              items={options.map((option) => option.label)}
              defaultSelected={selected}
              onChange={(index) => onChange(options[index].value)}
              onSelect={close}
              fontSize={1.05}
              spacing={2.5}
              inset={18}
              curve={0.25}
              tilt={4}
              blur={0}
              fade={0.24}
              minOpacity={0.12}
              textColor="#999999"
              activeColor="#eddfa8"
            />
          </div>
        </div>
      )}
    </div>
  );
}
