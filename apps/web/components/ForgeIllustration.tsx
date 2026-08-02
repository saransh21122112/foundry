/**
 * Hand-built SVG for the homepage's empty right column — no image-generation
 * tool is available in this environment, so this is a from-scratch vector
 * illustration in Foundry's own palette (--ember/--ember-hot/--surface/--line)
 * rather than a mismatched stock photo. Two stylized robot figures working
 * at forge stations: anvils, rising sparks, a shared overhead glow — reads
 * as "agents doing real work under a foundry's heat," the same metaphor
 * the homepage copy and AutonomyGauge component already use. Sparks pulse
 * via CSS (see .forge-spark in globals.css), same lightweight animation
 * pattern as the existing .pulse-dot — no animation library.
 */
export function ForgeIllustration() {
  return (
    <svg
      viewBox="0 0 520 520"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Two illustrated robot figures working at glowing forge stations"
      style={{ width: "100%", height: "auto", maxWidth: 480 }}
    >
      <defs>
        <radialGradient id="forgeGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f2843d" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#f2843d" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="botBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2a2830" />
          <stop offset="100%" stopColor="#201f26" />
        </linearGradient>
      </defs>

      {/* ambient overhead glow tying the two work stations together */}
      <circle cx="260" cy="180" r="220" fill="url(#forgeGlow)" />

      {/* floor line */}
      <line x1="20" y1="440" x2="500" y2="440" stroke="#37343d" strokeWidth="2" />

      {/* --- left robot, hammering at an anvil --- */}
      <g>
        <rect x="70" y="380" width="60" height="16" rx="3" fill="#16151a" stroke="#37343d" />
        <rect x="86" y="350" width="28" height="34" rx="4" fill="#16151a" stroke="#37343d" />
        <rect x="60" y="330" width="80" height="24" rx="4" fill="url(#botBody)" stroke="#37343d" />

        <rect x="72" y="230" width="66" height="104" rx="10" fill="url(#botBody)" stroke="#37343d" strokeWidth="2" />
        <rect x="86" y="248" width="38" height="14" rx="3" fill="#f2843d" opacity="0.85" />
        <circle cx="105" cy="210" r="26" fill="url(#botBody)" stroke="#37343d" strokeWidth="2" />
        <rect x="92" y="200" width="26" height="8" rx="4" fill="#f2843d" />

        {/* raised hammer arm */}
        <path d="M138 250 L172 210" stroke="#8b877e" strokeWidth="10" strokeLinecap="round" />
        <rect x="160" y="188" width="34" height="16" rx="3" transform="rotate(-32 160 188)" fill="#edeae3" opacity="0.85" />

        {/* resting arm */}
        <path d="M72 260 L46 296" stroke="#8b877e" strokeWidth="10" strokeLinecap="round" />
      </g>

      {/* left anvil the hammer is about to strike */}
      <g>
        <rect x="150" y="392" width="70" height="14" rx="3" fill="#16151a" stroke="#37343d" />
        <path d="M158 392 L172 358 L214 358 L226 392 Z" fill="url(#botBody)" stroke="#37343d" strokeWidth="2" />
        <circle className="forge-spark" cx="196" cy="352" r="3" fill="#f2843d" />
        <circle className="forge-spark forge-spark-delay-1" cx="206" cy="344" r="2.5" fill="#e5484d" />
        <circle className="forge-spark forge-spark-delay-2" cx="188" cy="340" r="2" fill="#f2843d" />
      </g>

      {/* --- right robot, monitoring a console/readout --- */}
      <g>
        <rect x="330" y="380" width="60" height="16" rx="3" fill="#16151a" stroke="#37343d" />
        <rect x="346" y="350" width="28" height="34" rx="4" fill="#16151a" stroke="#37343d" />
        <rect x="320" y="330" width="80" height="24" rx="4" fill="url(#botBody)" stroke="#37343d" />

        <rect x="332" y="228" width="66" height="106" rx="10" fill="url(#botBody)" stroke="#37343d" strokeWidth="2" />
        <rect x="346" y="246" width="38" height="14" rx="3" fill="#3ed9b0" opacity="0.8" />
        <circle cx="365" cy="208" r="26" fill="url(#botBody)" stroke="#37343d" strokeWidth="2" />
        <rect x="352" y="198" width="26" height="8" rx="4" fill="#3ed9b0" />

        {/* arm reaching to console */}
        <path d="M332 268 L296 292" stroke="#8b877e" strokeWidth="10" strokeLinecap="round" />
        <path d="M398 260 L424 240" stroke="#8b877e" strokeWidth="10" strokeLinecap="round" />
      </g>

      {/* console the right robot is reading */}
      <g>
        <rect x="418" y="196" width="72" height="52" rx="4" fill="#16151a" stroke="#37343d" strokeWidth="2" />
        <rect x="428" y="206" width="34" height="6" rx="3" fill="#3ed9b0" opacity="0.9" />
        <rect x="428" y="218" width="48" height="6" rx="3" fill="#8b877e" opacity="0.6" />
        <rect x="428" y="230" width="22" height="6" rx="3" fill="#f2843d" opacity="0.8" />
      </g>

      {/* connecting data line between the two work stations */}
      <path
        d="M220 300 C 260 270, 300 270, 300 300"
        stroke="#37343d"
        strokeWidth="2"
        strokeDasharray="4 6"
        fill="none"
      />
    </svg>
  );
}
