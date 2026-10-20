import type { GoldCountry, GoldCountryDetail, GoldUnit } from '@bla/shared';
import { TROY_OZ_PER_TONNE } from '@bla/shared';
import { Link } from 'react-router';

import {
  Drawer,
  DrawerError,
  DrawerReview,
  DrawerSection,
  DrawerSkeleton,
  DrawerSources,
} from '../../components/Drawer/Drawer';
import { drawerStyles } from '../../components/Drawer/drawerStyles';
import { FlagImage } from '../../components/FlagImage/FlagImage';
import { Icon } from '../../components/Icon/Icon';
import { RegionChip } from '../../components/RegionChip/RegionChip';
import { api } from '../../lib/api';
import { formatMass, formatMonth, formatPct, formatPrice, formatUsd } from '../../lib/goldUnits';
import { strings } from '../../lib/strings';
import { useResource } from '../../lib/useResource';
import { territoryNote } from '../map/territoryNotes';
import {
  ExportsFigure,
  HoldingsFigure,
  PresenceBadge,
  ProductionFigure,
  ShareFigure,
} from './GoldBits';
import styles from './GoldDrawer.module.css';

const text = strings.dhahabu.drawer;
const date = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export interface GoldDrawerProps {
  /** The row already on screen; the drawer's details are fetched on open. */
  row: GoldCountry;
  /** The reference year (undefined: latest available). */
  year: number | undefined;
  unit: GoldUnit;
  onClose: () => void;
}

/**
 * A country's gold in the shared drawer (spec 7.6 item 6): presence with its evidence, the key
 * figures at the reference year, production, trade (reported versus mirror, top partners),
 * central bank gold, in-ground reserves in their own block, artisanal mining, curated notes and
 * every source. Bottom sheet on phones.
 */
export function GoldDrawer({ row, year, unit, onClose }: GoldDrawerProps) {
  const { country } = row;
  const detail = useResource(
    `gold-country:${country.iso3}:${year === undefined ? 'latest' : String(year)}`,
    () => api.goldCountry(country.iso3, year),
  );
  const data = detail.status === 'success' ? detail.data.country : undefined;
  const loading = detail.status === 'loading';
  const note = territoryNote(country.iso3);

  return (
    <Drawer
      title={country.name}
      media={
        <FlagImage flag={country.flag} countryName={country.name} width={72} loading="eager" />
      }
      subtitle={<RegionChip slug={country.region.slug} name={country.region.name} />}
      accent={`var(--region-${country.region.slug})`}
      testId="gold-drawer"
      onClose={onClose}
    >
      {note !== undefined && <p className={drawerStyles.meta}>{note}</p>}
      <p className={styles.profileLink}>
        <Icon name="public" size={20} />
        <Link to={`/countries?country=${country.iso3}`} data-testid="gold-drawer-profile">
          {text.countryProfile}
        </Link>
      </p>

      {row.presence.needsReview && <DrawerReview notes={row.presence.reviewNotes} />}
      {detail.status === 'error' && <DrawerError error={detail.error} onRetry={detail.retry} />}

      <DrawerSection
        icon="table_view"
        title={text.atReference(year === undefined ? text.latestAvailable : text.upTo(year))}
      >
        <dl className={styles.figures}>
          <div>
            <dt>{strings.dhahabu.columns.production}</dt>
            <dd>
              <ProductionFigure row={row} unit={unit} />
            </dd>
          </div>
          <div>
            <dt>{strings.dhahabu.columns.exports}</dt>
            <dd>
              <ExportsFigure row={row} unit={unit} />
            </dd>
          </div>
          <div>
            <dt>{strings.dhahabu.columns.holdings}</dt>
            <dd>
              <HoldingsFigure row={row} unit={unit} />
            </dd>
          </div>
          <div>
            <dt>{strings.dhahabu.columns.share}</dt>
            <dd>
              <ShareFigure row={row} />
            </dd>
          </div>
        </dl>
      </DrawerSection>

      <DrawerSection icon="diamond" title={text.presence}>
        <p className={styles.presence}>
          <PresenceBadge row={row} />
        </p>
        {/* The summary usually quotes the evidence; show the evidence on its own otherwise. */}
        {!row.presence.summary.includes(row.presence.basis) && <p>{row.presence.basis}</p>}
        {row.presence.summary !== '' && <p>{row.presence.summary}</p>}
        <p className={drawerStyles.meta}>
          {strings.dhahabu.confidence[row.presence.confidence]}
          {row.presence.asOfYear !== null && ` · ${text.evidenceYear(row.presence.asOfYear)}`}
          {row.presence.commercialMining === true && ` · ${text.commercial}`}
          {row.presence.source && (
            <>
              {' · '}
              <a href={row.presence.source.url} target="_blank" rel="noopener noreferrer">
                {row.presence.source.title}
              </a>
            </>
          )}
        </p>
      </DrawerSection>

      {loading && <DrawerSkeleton count={6} />}
      {data && <Details data={data} row={row} unit={unit} />}
    </Drawer>
  );
}

function Details({
  data,
  row,
  unit,
}: {
  data: GoldCountryDetail;
  row: GoldCountry;
  unit: GoldUnit;
}) {
  const maxTonnes = Math.max(0, ...data.production.map((p) => p.tonnes ?? 0));
  return (
    <>
      <DrawerSection icon="savings" title={text.production}>
        {data.production.length === 0 ? (
          <p className={drawerStyles.meta}>{text.productionNone}</p>
        ) : (
          <table className={styles.table} data-testid="gold-drawer-production">
            <thead>
              <tr>
                <th scope="col">{text.productionColumns.year}</th>
                <th scope="col">{text.productionColumns.tonnes}</th>
                <th scope="col" className={styles.number}>
                  {text.productionColumns.value}
                </th>
              </tr>
            </thead>
            <tbody>
              {[...data.production].reverse().map((p) => (
                <tr key={p.year}>
                  <th scope="row">{p.year}</th>
                  <td>
                    <span className={styles.barCell}>
                      {p.tonnes !== null && maxTonnes > 0 && (
                        <span
                          className={styles.miniBar}
                          style={{ width: `${String((p.tonnes / maxTonnes) * 100)}%` }}
                          aria-hidden="true"
                        />
                      )}
                      <span className={styles.barLabel}>
                        {p.tonnes === null
                          ? strings.dhahabu.includedInOther
                          : formatMass(p.tonnes, unit)}
                        {p.basis === 'estimate' && ` ${strings.dhahabu.estimate}`}
                      </span>
                    </span>
                  </td>
                  <td className={styles.number}>
                    {p.valueUsd === null ? '—' : formatUsd(p.valueUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DrawerSection>

      <DrawerSection icon="compare_arrows" title={text.trade}>
        <p className={drawerStyles.meta}>{text.tradeNote}</p>
        {data.trade.length === 0 ? (
          <p className={drawerStyles.meta}>{text.tradeNone}</p>
        ) : (
          <div className={styles.scroll}>
            <table className={styles.table} data-testid="gold-drawer-trade">
              <thead>
                <tr>
                  <th scope="col">{text.tradeColumns.year}</th>
                  <th scope="col" className={styles.number}>
                    {text.tradeColumns.exports}
                  </th>
                  <th scope="col" className={styles.number}>
                    {text.tradeColumns.mirror}
                  </th>
                  <th scope="col" className={styles.number}>
                    {text.tradeColumns.imports}
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...data.trade].reverse().map((t) => (
                  <tr key={t.year}>
                    <th scope="row">{t.year}</th>
                    <td className={styles.number}>
                      {t.exportsReported ? formatUsd(t.exportsReported.valueUsd) : '—'}
                    </td>
                    <td className={styles.number}>
                      {t.exportsMirror ? formatUsd(t.exportsMirror.valueUsd) : '—'}
                    </td>
                    <td className={styles.number}>
                      {t.importsReported ? formatUsd(t.importsReported.valueUsd) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.partners && (
          <div className={styles.partners} data-testid="gold-drawer-partners">
            <p className={styles.subheading}>{text.partners(data.partners.year)}</p>
            {(['reported', 'mirror'] as const).map((basis) =>
              data.partners?.[basis].length ? (
                <div key={basis}>
                  <p className={drawerStyles.meta}>
                    {basis === 'reported' ? text.partnersReported : text.partnersMirror}
                  </p>
                  <ol className={styles.partnerList}>
                    {data.partners[basis].slice(0, 5).map((p) => (
                      <li key={p.rank}>
                        <span>{p.name}</span>
                        <span className={styles.number}>{formatUsd(p.valueUsd)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null,
            )}
          </div>
        )}
      </DrawerSection>

      <DrawerSection icon="account_balance" title={text.holdings}>
        {data.holdings.length === 0 ? (
          <p className={drawerStyles.meta}>
            {row.reporting ? row.reporting.note : text.holdingsNone}
          </p>
        ) : (
          <>
            <p className={drawerStyles.meta}>{text.holdingsNote}</p>
            <div className={styles.scroll}>
              <table className={styles.table} data-testid="gold-drawer-holdings">
                <thead>
                  <tr>
                    <th scope="col">{text.holdingsColumns.month}</th>
                    <th scope="col" className={styles.number}>
                      {text.holdingsColumns.tonnes}
                    </th>
                    <th scope="col" className={styles.number}>
                      {text.holdingsColumns.value}
                    </th>
                    <th scope="col" className={styles.number}>
                      {text.holdingsColumns.share}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.holdings].reverse().map((h) => (
                    <tr key={h.asOf}>
                      <th scope="row">{formatMonth(h.asOf)}</th>
                      <td className={styles.number}>{formatMass(h.tonnes, unit)}</td>
                      <td className={styles.number}>{formatUsd(h.valueUsd)}</td>
                      <td className={styles.number}>
                        {h.pctOfReserves === null ? '—' : formatPct(h.pctOfReserves)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </DrawerSection>

      {data.inground.length > 0 && (
        <DrawerSection icon="layers" title={text.inground}>
          <div className={styles.inground} data-testid="gold-drawer-inground">
            <p className={drawerStyles.meta}>{text.ingroundNote}</p>
            {data.inground.map((r) => (
              <div key={`${String(r.year)}-${r.source}`} className={styles.ingroundItem}>
                <p>
                  <strong>{formatMass(r.tonnes, unit)}</strong> ({r.year})
                </p>
                {data.latestPrice && (
                  <p className={drawerStyles.meta}>
                    {text.illustrative(
                      formatUsd(r.tonnes * TROY_OZ_PER_TONNE * data.latestPrice.usdPerOz),
                      formatPrice(data.latestPrice.usdPerOz),
                      formatMonth(data.latestPrice.month),
                    )}
                  </p>
                )}
                <p className={drawerStyles.meta}>
                  {r.definition} · {r.source}
                </p>
              </div>
            ))}
          </div>
        </DrawerSection>
      )}

      {row.presence.asmPresent !== null && (
        <DrawerSection icon="construction" title={text.artisanal}>
          <p>{row.presence.asmPresent ? text.asmPresent : text.asmAbsent}</p>
          {row.presence.asmSharePct !== null && (
            <p>{text.asmShare(formatPct(row.presence.asmSharePct))}</p>
          )}
          {data.artisanalSource && (
            <p className={drawerStyles.meta}>
              {text.asmSource}:{' '}
              <a href={data.artisanalSource.url} target="_blank" rel="noopener noreferrer">
                {data.artisanalSource.title}
              </a>
            </p>
          )}
        </DrawerSection>
      )}

      {data.notes.length > 0 && (
        <DrawerSection icon="notes" title={text.notes}>
          <ul className={styles.notes} data-testid="gold-drawer-notes">
            {data.notes.map((n, index) => (
              <li key={index}>
                <p>{n.note}</p>
                <p className={drawerStyles.meta}>
                  <a href={n.source.url} target="_blank" rel="noopener noreferrer">
                    {text.noteMeta(n.source.title, date.format(new Date(n.asOf)))}
                  </a>
                  {n.needsReview && ` · ${strings.drawer.needsReview}`}
                </p>
              </li>
            ))}
          </ul>
        </DrawerSection>
      )}

      <DrawerSection icon="menu_book" title={text.sources}>
        <DrawerSources
          note={text.sourcesNote}
          sources={data.sources.map((s) => ({
            key: s.url + s.title,
            title: s.title,
            url: s.url,
            reliabilityTier: s.reliabilityTier,
            usedFor: s.usedFor.map((key) => text.usedFor[key] ?? key),
          }))}
        />
      </DrawerSection>
    </>
  );
}
