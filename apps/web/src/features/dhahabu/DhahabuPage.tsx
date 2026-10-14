import { PageHeader } from '../../components/PageHeader/PageHeader';
import { UnderConstruction } from '../../components/UnderConstruction/UnderConstruction';
import { strings } from '../../lib/strings';

export function DhahabuPage() {
  const page = strings.pages.dhahabu;
  return (
    <>
      <title>{`${page.title} · ${strings.site.name}`}</title>
      <meta name="description" content={page.description} />
      <PageHeader icon="diamond" title={page.title} description={page.description} />
      <UnderConstruction />
    </>
  );
}
