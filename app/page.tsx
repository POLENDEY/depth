import { Studio } from "@/components/studio";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-5 py-8">
      <header className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">3D keychain generator</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          Type a name to generate a printable keychain. Drag the preview to look around, set the real-world size
          and colors, then download a file for your slicer.
        </p>
      </header>
      <Studio />
    </main>
  );
}
