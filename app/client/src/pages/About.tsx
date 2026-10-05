import { ExternalLink } from 'lucide-react';
import { PageFrame } from '../components/PageFrame.tsx';
import { useI18n } from '../i18n/index.tsx';
import type { I18nKey } from '../i18n/ja.ts';

const POINTS: { title: I18nKey; body: I18nKey }[] = [
  { title: 'about.p1.title', body: 'about.p1.body' },
  { title: 'about.p2.title', body: 'about.p2.body' },
  { title: 'about.p3.title', body: 'about.p3.body' },
  { title: 'about.p4.title', body: 'about.p4.body' },
  { title: 'about.p5.title', body: 'about.p5.body' },
  { title: 'about.p6.title', body: 'about.p6.body' },
];

const DIAGRAMS: { src: string; caption: I18nKey }[] = [
  { src: '/diagrams/01-qa-routing-flow.png', caption: 'about.diagram1' },
  { src: '/diagrams/02-databricks-architecture.png', caption: 'about.diagram2' },
];

export function About() {
  const { t } = useI18n();
  return (
    <PageFrame title={t('about.title')} intro={t('about.lead')}>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {POINTS.map((p) => (
          <section key={p.title} className="rounded-lg border bg-card p-4">
            <h3 className="font-semibold text-primary">{t(p.title)}</h3>
            <p className="mt-1.5 text-muted-foreground">{t(p.body)}</p>
          </section>
        ))}
      </div>
      <p className="rounded-md bg-[#fff6d6] px-4 py-2 text-xs font-medium text-[#6b4b00]">
        {t('about.placeholderNote')}
      </p>
      {DIAGRAMS.map((d) => (
        <figure key={d.src} className="rounded-lg border bg-card p-4">
          <figcaption className="mb-3 flex flex-wrap items-center justify-between gap-2 font-semibold">
            {t(d.caption)}
            <a
              href={d.src}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary underline"
            >
              {t('about.openImage')}
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </figcaption>
          <div className="overflow-x-auto">
            <img
              src={d.src}
              alt={t(d.caption)}
              loading="lazy"
              className="h-auto w-full min-w-[640px] max-w-none bg-white md:min-w-0"
            />
          </div>
        </figure>
      ))}
    </PageFrame>
  );
}
