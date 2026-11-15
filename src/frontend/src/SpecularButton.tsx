import type { ComponentPropsWithRef, CSSProperties } from "react";
import GlassSurface from "./reactbits/GlassSurface";

// Supplied React Bits GlassSurface styling with native button semantics.
export function SpecularButton({
  radius = 38,
  className = "",
  style,
  type = "button",
  children,
  ...props
}: ComponentPropsWithRef<"button"> & { radius?: number }) {
  const glassRadius = /(?:^|\s)(round-button|dialog-close)(?:\s|$)/.test(
    className,
  )
    ? 999
    : radius;
  return (
    <button
      type={type}
      className={`specular-button ${className}`}
      style={{ "--sb-radius": `${glassRadius}px`, ...style } as CSSProperties}
      {...props}
    >
      <span className="specular-button__glass" aria-hidden="true">
        <GlassSurface
          as="span"
          width="100%"
          height="100%"
          borderRadius={glassRadius}
          distortionScale={-180}
          displace={0.5}
          backgroundOpacity={0.1}
        />
      </span>
      <span className="specular-button__label">{children}</span>
    </button>
  );
}
