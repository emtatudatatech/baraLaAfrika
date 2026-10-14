import { PageHeader } from '../../components/PageHeader/PageHeader';
import { UnderConstruction } from '../../components/UnderConstruction/UnderConstruction';
import { strings } from '../../lib/strings';

export function CountriesPage() {
  const page = strings.pages.countries;
  return (
    <>
      <title>{`${page.title} · ${strings.site.name}`}</title>
      <meta name="description" content={page.description} />
      <PageHeader icon="flag" title={page.title} description={page.description} />
      <UnderConstruction />
    </>
  );
}
