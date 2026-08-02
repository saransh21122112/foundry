import { ClerkProvider } from "@clerk/nextjs";
import { Space_Grotesk, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono" });

export const metadata = {
  title: "Foundry",
  description: "Your AI company, running itself within guardrails.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      // Clerk's default theme assumes a light page and renders its own
      // widgets (UserButton, OrganizationSwitcher) with dark text on a
      // light background — invisible against this app's dark UI (reported
      // live: "My Organization" text was black-on-black). No `@clerk/themes`
      // dependency needed for this — `variables` alone is enough to match
      // Foundry's own palette (hardcoded here, not `var(--ink)` etc., since
      // Clerk renders these into its own portal before this page's CSS
      // custom properties are guaranteed to have resolved).
      appearance={{
        variables: {
          colorBackground: "#201f26", // --surface
          colorForeground: "#edeae3", // --paper
          colorPrimary: "#f2843d", // --ember
          colorPrimaryForeground: "#16151a", // --ink
          colorNeutral: "#edeae3",
          colorMutedForeground: "#8b877e", // --iron
          colorInput: "#16151a", // --ink
          colorInputForeground: "#edeae3",
          colorBorder: "#37343d", // --line
          colorDanger: "#e5484d", // --ember-hot
          colorSuccess: "#3ed9b0", // --cool
          borderRadius: "3px",
        },
      }}
    >
      <html lang="en" className={`${spaceGrotesk.variable} ${inter.variable} ${plexMono.variable}`}>
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
