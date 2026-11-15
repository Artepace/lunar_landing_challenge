import ReactBitsOptionWheel from "./reactbits/OptionWheel";

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
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  return (
    <div className="planner-site-wheel">
      <div className="planner-wheel-viewport">
        <ReactBitsOptionWheel
          label={label}
          items={options.map((option) => option.label)}
          defaultSelected={selected}
          selected={selected}
          onChange={(index) => {
            if (options[index]) onChange(options[index].value);
          }}
          textColor="#a6a6a6"
          activeColor="#eddfa8"
          side="left"
          fontSize={1.85}
          spacing={1.6}
          curve={1}
          tilt={6}
          blur={1.5}
          fade={0.25}
          smoothing={50}
          inset={32}
          loop={options.length > 1}
          draggable
        />
      </div>
    </div>
  );
}
