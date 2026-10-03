import type { ReactNode } from "react";

export function ProductArt({ slug }: { slug: string }) {
  if (slug === "name-keychain") return <KeychainArt />;
  if (slug === "initial-keychain") return <InitialArt />;
  if (slug === "spotify-code") return <SpotifyArt />;
  if (slug === "cable-tag") return <CableArt />;
  if (slug === "articulated-name") return <ArticulatedArt />;
  if (slug === "pen-holder") return <PenArt />;
  if (slug === "picture-frame") return <FrameArt />;
  if (slug === "nameplate") return <PlateArt />;
  if (slug === "planter") return <PlanterArt />;
  if (slug === "plant-label") return <LabelArt />;
  if (slug === "magnet") return <MagnetArt />;
  if (slug === "wall-art") return <WallArt />;
  if (slug === "glass-marker") return <GlassArt />;
  return <HeadbandArt />;
}

function Scene({
  id,
  children,
  from,
  to,
}: {
  id: string;
  children: ReactNode;
  from: string;
  to: string;
}) {
  const gradient = `art-${id}`;
  return (
    <svg viewBox="0 0 320 240" className="h-full w-full" role="img" aria-hidden="true">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <rect width="320" height="240" fill={`url(#${gradient})`} />
      {children}
    </svg>
  );
}

function KeychainArt() {
  return (
    <Scene id="keychain" from="#f3e6d8" to="#e7d3bf">
      <text x="78" y="150" fill="#e11d48" fontFamily="Pacifico, cursive" fontSize="72">
        nora
      </text>
      <text x="86" y="142" fill="#f4f4f5" fontFamily="Pacifico, cursive" fontSize="64">
        nora
      </text>
    </Scene>
  );
}

function InitialArt() {
  return (
    <Scene id="initial" from="#f7f1e8" to="#efe4d4">
      <circle cx="118" cy="124" r="58" fill="#8ea37a" />
      <text x="96" y="142" fill="#fffaf3" fontFamily="Lilita One, sans-serif" fontSize="64">
        H
      </text>
      <path
        d="M214 150c-18 0-22-16-22-28 0-18 16-28 28-18 12-10 28 0 28 18 0 12-4 28-22 28-6 10-12 16-12 16s-6-6-12-16z"
        fill="#f6d56a"
      />
      <text x="214" y="148" textAnchor="middle" fill="#fffaf3" fontFamily="Lilita One, sans-serif" fontSize="36">
        P
      </text>
    </Scene>
  );
}

function SpotifyArt() {
  return (
    <Scene id="spotify" from="#1c1c1c" to="#111111">
      <rect x="132" y="24" width="56" height="192" rx="28" fill="#161616" />
      <circle cx="160" cy="52" r="7" fill="#111" stroke="#1db954" strokeWidth="4" />
      <rect x="142" y="78" width="36" height="5" rx="2.5" fill="#1db954" />
      <rect x="128" y="90" width="64" height="5" rx="2.5" fill="#1db954" />
      <rect x="136" y="102" width="48" height="5" rx="2.5" fill="#1db954" />
      <rect x="122" y="114" width="76" height="5" rx="2.5" fill="#1db954" />
      <rect x="146" y="126" width="28" height="5" rx="2.5" fill="#1db954" />
      <rect x="130" y="138" width="60" height="5" rx="2.5" fill="#1db954" />
      <rect x="124" y="150" width="72" height="5" rx="2.5" fill="#1db954" />
      <rect x="150" y="162" width="20" height="5" rx="2.5" fill="#1db954" />
      <circle cx="160" cy="188" r="6" fill="#2a2a2a" />
    </Scene>
  );
}

function CableArt() {
  return (
    <Scene id="cable" from="#d7b899" to="#c4a484">
      <rect x="20" y="108" width="280" height="18" rx="9" fill="#f8fafc" />
      <text x="70" y="128" fill="#bfdbfe" fontFamily="Lilita One, sans-serif" fontSize="54">
        JOHN
      </text>
    </Scene>
  );
}

function ArticulatedArt() {
  return (
    <Scene id="articulated" from="#c4a484" to="#a98467">
      <text x="28" y="150" fill="#e7e5e4" fontFamily="Lilita One, sans-serif" fontSize="42">
        ISABELLA
      </text>
      <text x="28" y="138" fill="#e11d48" fontFamily="Lilita One, sans-serif" fontSize="42">
        ISABELLA
      </text>
    </Scene>
  );
}

function PenArt() {
  return (
    <Scene id="pen" from="#e7d3bf" to="#d2b48c">
      <rect x="118" y="28" width="8" height="70" rx="2" fill="#facc15" />
      <text x="48" y="168" fill="#111827" fontFamily="Bangers, sans-serif" fontSize="78">
        JUNE
      </text>
      <text x="54" y="160" fill="#f97316" fontFamily="Bangers, sans-serif" fontSize="72">
        JUNE
      </text>
    </Scene>
  );
}

function FrameArt() {
  return (
    <Scene id="frame" from="#f5e6d3" to="#ead7c4">
      <rect x="78" y="36" width="150" height="150" rx="8" fill="#d6d3d1" />
      <rect x="98" y="52" width="112" height="118" fill="#93c5fd" />
      <text x="214" y="150" fill="#fafaf9" fontFamily="Lilita One, sans-serif" fontSize="28" transform="rotate(-90 214 150)">
        PARIS
      </text>
    </Scene>
  );
}

function PlateArt() {
  return (
    <Scene id="plate" from="#8b5e3c" to="#6b4423">
      <rect x="46" y="150" width="228" height="16" rx="3" fill="#1d4ed8" />
      <text x="58" y="148" fill="#3b82f6" fontFamily="Lilita One, sans-serif" fontSize="58">
        OLIVER
      </text>
    </Scene>
  );
}

function PlanterArt() {
  return (
    <Scene id="planter" from="#e5e7eb" to="#d1d5db">
      <ellipse cx="150" cy="168" rx="78" ry="16" fill="#a16207" />
      <path d="M78 168 C78 80 222 80 222 168" fill="#4d7c0f" />
      <ellipse cx="150" cy="80" rx="72" ry="14" fill="#ecfccb" />
    </Scene>
  );
}

function LabelArt() {
  return (
    <Scene id="label" from="#d9f99d" to="#86efac">
      <rect x="148" y="70" width="10" height="120" rx="2" fill="#bbf7d0" />
      <rect x="108" y="48" width="90" height="36" rx="4" fill="#166534" />
      <text x="118" y="74" fill="#f0fdf4" fontFamily="Lilita One, sans-serif" fontSize="24">
        MINT
      </text>
    </Scene>
  );
}

function MagnetArt() {
  return (
    <Scene id="magnet" from="#f7f4ef" to="#ece7df">
      <text x="28" y="78" fill="#2f6fed" stroke="#f6f3ee" strokeWidth="8" paintOrder="stroke" fontFamily="Pacifico, cursive" fontSize="40">
        Emma
      </text>
      <text x="168" y="86" fill="#e15b64" stroke="#f6f3ee" strokeWidth="8" paintOrder="stroke" fontFamily="Pacifico, cursive" fontSize="40">
        Liam
      </text>
      <text x="86" y="158" fill="#7c3aed" stroke="#f6f3ee" strokeWidth="9" paintOrder="stroke" fontFamily="Pacifico, cursive" fontSize="44">
        Amelia
      </text>
    </Scene>
  );
}

function WallArt() {
  return (
    <Scene id="wall" from="#f5f0ea" to="#e7e0d6">
      <rect x="0" y="150" width="320" height="50" fill="#d6d3d1" />
      <text x="48" y="110" fill="#fafaf9" fontFamily="Pacifico, cursive" fontSize="48">
        Wall Art
      </text>
    </Scene>
  );
}

function GlassArt() {
  return (
    <Scene id="glass" from="#fde68a" to="#fcd34d">
      <path d="M118 30 C118 30 100 110 100 140 C100 180 220 180 220 140 C220 110 202 30 202 30 Z" fill="#e0f2fe" fillOpacity="0.85" />
      <text x="214" y="150" fill="#fb7185" fontFamily="Bangers, sans-serif" fontSize="28" transform="rotate(-90 214 120)">
        SOFIA
      </text>
    </Scene>
  );
}

function HeadbandArt() {
  return (
    <Scene id="headband" from="#fef3c7" to="#fde68a">
      <path d="M70 170 C70 70 250 70 250 170" fill="none" stroke="#f8fafc" strokeWidth="28" strokeLinecap="round" />
      <text x="78" y="78" fill="#1d4ed8" fontFamily="Lilita One, sans-serif" fontSize="36">
        NATHAN
      </text>
    </Scene>
  );
}
