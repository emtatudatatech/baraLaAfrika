import { PageHeader } from '../../components/PageHeader/PageHeader';
import { UnderConstruction } from '../../components/UnderConstruction/UnderConstruction';
import { strings } from '../../lib/strings';

export function HarimPage() {
  const page = strings.pages.harim;
  return (
    <>
      <title>{`${page.title} · ${strings.site.name}`}</title>
      <meta name="description" content={page.description} />
      <PageHeader icon="landscape" title={page.title} description={page.description} />
      <UnderConstruction />
    </>
  );
}
