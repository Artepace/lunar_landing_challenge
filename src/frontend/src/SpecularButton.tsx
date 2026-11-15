import type { ComponentPropsWithRef, CSSProperties } from "react";

// Shared, quiet button treatment; kept as the existing component API.
export function SpecularButton({
  radius = 10,
  className = "",
  style,
  type = "button",
  ...props
}: ComponentPropsWithRef<"button"> & { radius?: number }) {
  return (
    <button
      type={type}
      className={`specular-button ${className}`}
      style={{ "--sb-radius": `${radius}px`, ...style } as CSSProperties}
      {...props}
    />
  );
}
