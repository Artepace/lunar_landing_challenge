import { useRef, type ReactNode } from "react";
import { NoiseBackground } from "./NoiseBackground";
import { SpecularButton } from "./SpecularButton";

export function Chrome({
  children,
  motion,
  onToggleMotion,
}: {
  children: ReactNode;
  motion: boolean;
  onToggleMotion: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const dialogScroll = useRef(0);
  const openAbout = () => {
    dialogScroll.current = window.scrollY;
    dialog.current?.showModal();
  };
  const motionLabel = motion
    ? "Pause background motion"
    : "Play background motion";

  return (
    <>
      <NoiseBackground motion={motion} />
      <a className="skip" href="#site-form">
        Skip to landing coordinates
      </a>
      <header className="masthead">
        <a
          className="brand-link"
          href="#explore"
          aria-label="SELENE — lunar explorer"
        >
          <img
            className="selene-symbol"
            src={import.meta.env.BASE_URL + "selene-mark.svg"}
            alt=""
            width="40"
            height="40"
          />
          <span className="brand-wordmark">SELENE</span>
        </a>
      </header>
      <main>{children}</main>
      <footer className="site-footer">
        <SpecularButton onClick={openAbout} className="footer-action">
          About the model ↗
        </SpecularButton>
        <SpecularButton onClick={onToggleMotion} className="footer-action">
          {motionLabel}
        </SpecularButton>
      </footer>
      <dialog
        ref={dialog}
        onClose={() =>
          window.scrollTo({ top: dialogScroll.current, behavior: "instant" })
        }
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const r = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < r.left ||
              event.clientX > r.right ||
              event.clientY < r.top ||
              event.clientY > r.bottom
            )
              event.currentTarget.close();
          }
        }}
      >
        <SpecularButton
          onClick={() => dialog.current?.close()}
          className="dialog-close"
          aria-label="Close information"
        >
          ×
        </SpecularButton>
        <span className="eyebrow">PROTOTYPE / V0.1</span>
        <h2>A window onto the Moon.</h2>
        <p>
          This frontend explores selecting lunar coordinates, descending to a
          surface viewpoint, looking toward the Sun and Earth, and checking
          future events.
        </p>
        <h3>Visibility data</h3>
        <p>
          JPL Horizons gives the Sun and Earth directions every 15 minutes. NASA
          LOLA elevation maps supply the south-pole skyline where coverage
          allows. Elsewhere, the explorer uses the geometric horizon.
        </p>
        <h3>What is illustrative</h3>
        <p>
          The Surface view uses elevations from LOLA where covered. Ground
          texture, lighting, and Earth station orientation are illustrative.
          Body sizes and distances are exaggerated. Visibility alone cannot
          establish usable power or a radio link.
        </p>
        <h3>Free rendering, no API key</h3>
        <p>
          <a href="https://threejs.org/" target="_blank" rel="noreferrer">
            Three.js
          </a>{" "}
          renders the scene.{" "}
          <a
            href="https://svs.gsfc.nasa.gov/14959/"
            target="_blank"
            rel="noreferrer"
          >
            NASA’s Moon 3D model
          </a>{" "}
          supplies the orbital globe, credited to NASA’s Goddard Space Flight
          Center. The preview uses the NASA CGI Moon Kit, and the Earth texture
          comes from the Three.js examples collection.
        </p>
      </dialog>
    </>
  );
}
