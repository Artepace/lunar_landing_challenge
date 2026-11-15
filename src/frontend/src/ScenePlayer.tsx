import GlassSurface from "./reactbits/GlassSurface";
import { SpecularButton } from "./SpecularButton";
import { WINDOW_HOURS } from "./visibility";

type Props = {
  time: number;
  offset: number;
  playing: boolean;
  disabled: boolean;
  onOffset: (hours: number) => void;
  onTogglePlay: () => void;
  className?: string;
  note: string;
  distortionScale?: number;
  greenOffset?: number;
};
export function ScenePlayer({
  time,
  offset,
  playing,
  disabled,
  onOffset,
  onTogglePlay,
  className = "",
  note,
  distortionScale = -180,
  greenOffset = 10,
}: Props) {
  return (
    <div className={`orbital-console glass-player ${className}`}>
      <div className="player-glass" aria-hidden="true">
        <GlassSurface
          width="100%"
          height="100%"
          borderRadius={18}
          distortionScale={distortionScale}
          greenOffset={greenOffset}
          displace={0.5}
          backgroundOpacity={0.1}
        />
      </div>
      <div className="time-console orbital-controls">
        <div>
          <span className="eyebrow">SCENE TIME / UTC</span>
          <strong>
            {new Date(time).toISOString().slice(0, 16).replace("T", " ")}
          </strong>
        </div>
        <div className="scrubber">
          <label htmlFor="orbit-time">
            Explore after landing <output>+{offset.toFixed(2)} h</output>
          </label>
          <input
            id="orbit-time"
            type="range"
            min="0"
            max={WINDOW_HOURS}
            step="0.25"
            value={offset}
            disabled={disabled}
            onChange={(event) => onOffset(event.currentTarget.valueAsNumber)}
          />
          <div className="ticks">
            <span>Landing</span>
            <span>+24 h</span>
            <span>+48 h</span>
            <span>+72 h</span>
          </div>
        </div>
        <SpecularButton
          className="play-button"
          aria-pressed={playing}
          onClick={onTogglePlay}
          disabled={disabled}
        >
          {playing ? "Ⅱ Pause" : "▶ Play"}
        </SpecularButton>
      </div>
      <p className="panel-note">{note} </p>
    </div>
  );
}
