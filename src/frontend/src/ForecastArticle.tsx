import type { ReactNode } from "react";
import GlassSurface from "./reactbits/GlassSurface";

export function ForecastArticle({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <article className={`forecast-article ${className}`}>
      <div className="forecast-article-glass" aria-hidden="true">
        <GlassSurface
          width="100%"
          height="100%"
          borderRadius={20}
          distortionScale={-180}
          displace={0.5}
          backgroundOpacity={0.1}
        />
      </div>
      <div className="forecast-article-content">{children}</div>
    </article>
  );
}
