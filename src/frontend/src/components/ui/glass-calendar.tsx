import { useEffect, useState } from "react";
import { SpecularButton } from "../../SpecularButton";
import "./glass-calendar.css";

const months = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(
    Date.UTC(2026, month, 1),
  ),
);
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** Adapted from the supplied glass calendar to the site's CSS and UTC model. */
export function GlassCalendar({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const selectedDay = value.slice(0, 10);
  const [month, setMonth] = useState(
    () => new Date(`${selectedDay.slice(0, 7)}-01T00:00:00Z`),
  );
  const [time, setTime] = useState(value.slice(11, 16));
  useEffect(() => {
    setMonth(new Date(`${selectedDay.slice(0, 7)}-01T00:00:00Z`));
  }, [selectedDay]);
  useEffect(() => {
    setTime(value.slice(11, 16));
  }, [value]);
  const year = month.getUTCFullYear();
  const index = month.getUTCMonth();
  const firstDay = (month.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
  const today = isoDay(new Date());
  const changeMonth = (delta: number) =>
    setMonth(new Date(Date.UTC(year, index + delta, 1)));
  return (
    <div className="glass-calendar">
      <div className="calendar-kicker">
        <span className="eyebrow">LANDING DATE</span>
        <span>UTC</span>
      </div>
      <div className="calendar-header">
        <div className="calendar-month">
          <label className="sr-only" htmlFor="landing-month">
            Month
          </label>
          <select
            id="landing-month"
            value={index}
            onChange={(event) =>
              setMonth(new Date(Date.UTC(year, Number(event.target.value), 1)))
            }
          >
            {months.map((name, i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="landing-year">
            Year
          </label>
          <select
            id="landing-year"
            value={year}
            onChange={(event) =>
              setMonth(new Date(Date.UTC(Number(event.target.value), index, 1)))
            }
          >
            {Array.from({ length: 101 }, (_, i) => (
              <option key={i} value={2000 + i}>
                {2000 + i}
              </option>
            ))}
          </select>
        </div>
        <div className="calendar-navigation">
          <SpecularButton
            aria-label="Previous month"
            disabled={year === 2000 && index === 0}
            onClick={() => changeMonth(-1)}
          >
            ‹
          </SpecularButton>
          <SpecularButton
            aria-label="Next month"
            disabled={year === 2100 && index === 11}
            onClick={() => changeMonth(1)}
          >
            ›
          </SpecularButton>
        </div>
      </div>
      <div
        className="calendar-grid"
        role="group"
        aria-label={`${months[index]} ${year}`}
      >
        {weekdays.map((day) => (
          <span className="calendar-weekday" key={day}>
            {day}
          </span>
        ))}
        {Array.from({ length: firstDay }, (_, i) => (
          <span key={`blank-${i}`} />
        ))}
        {Array.from({ length: count }, (_, i) => {
          const day = new Date(Date.UTC(year, index, i + 1));
          const key = isoDay(day);
          return (
            <button
              type="button"
              key={key}
              className={`calendar-day${key === selectedDay ? " is-selected" : ""}${key === today ? " is-today" : ""}`}
              aria-label={new Intl.DateTimeFormat("en-GB", {
                dateStyle: "full",
                timeZone: "UTC",
              }).format(day)}
              aria-pressed={key === selectedDay}
              aria-current={key === today ? "date" : undefined}
              onClick={() =>
                onChange(
                  `${key}T${/^\d{2}:\d{2}$/.test(time) ? time : value.slice(11, 16)}`,
                )
              }
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      <div className="calendar-time">
        <label htmlFor="landing-time">
          Landing time <span>UTC</span>
        </label>
        <input
          id="landing-time"
          type="time"
          step="60"
          required
          value={time}
          onChange={(event) => {
            setTime(event.currentTarget.value);
            if (event.currentTarget.validity.valid && event.currentTarget.value)
              onChange(`${selectedDay}T${event.currentTarget.value}`);
          }}
        />
      </div>
    </div>
  );
}
