'use client';

import Image from 'next/image';

const COLUMNS: { title: string; links: string[] }[] = [
  { title: 'Product', links: ['Search', 'Knowledge graph', 'Memory', 'Actions', 'Integrations'] },
  { title: 'Company', links: ['About', 'Careers', 'Blog', 'Contact'] },
  { title: 'Resources', links: ['Docs', 'Security', 'Changelog', 'Status'] },
  { title: 'Legal', links: ['Privacy', 'Terms', 'DPA', 'SOC 2'] },
];

export function Footer() {
  return (
    <footer className="relative border-t border-white/10 bg-[#05060d]">
      <div className="mx-auto max-w-6xl px-5 py-16">
        <div className="grid gap-10 md:grid-cols-[1.5fr_repeat(4,1fr)]">
          <div>
            <div className="flex items-center gap-2.5">
              <Image src="/logo.png" alt="Company Brain" width={32} height={32} />
              <span className="font-semibold tracking-tight">Company Brain</span>
            </div>
            <p className="mt-4 max-w-xs text-sm text-white/40">
              The living memory of your company. One question away.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="mb-3 text-xs font-medium uppercase tracking-widest text-white/40">
                {col.title}
              </p>
              <ul className="space-y-2.5">
                {col.links.map((l) => (
                  <li key={l}>
                    <a
                      href="#"
                      className="text-sm text-white/55 transition-colors hover:text-white"
                    >
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 text-xs text-white/35 sm:flex-row">
          <p>© {new Date().getFullYear()} Company Brain. All rights reserved.</p>
          <p>Built for teams that remember.</p>
        </div>
      </div>
    </footer>
  );
}
