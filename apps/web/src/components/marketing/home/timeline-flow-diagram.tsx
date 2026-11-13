import { FileText, Link2, Mail } from 'lucide-react';
import Image from 'next/image';

import type { CSSProperties } from 'react';

import styles from '@/app/(landing)/home.module.css';
import { HeroFlowControls } from '@/components/marketing/home/hero-flow-controls';
import { HeroRecordMesh } from '@/components/marketing/home/hero-record-mesh';
import { TimelineFlowMotion } from '@/components/marketing/home/timeline-flow-motion';
import { PUBLIC_DEMO_STORY } from '@/components/marketing/public-demo-story';
import { cn } from '@/lib/utils';

type TimelineFlowDiagramProps =
  | {
      readonly variant: 'hero';
      readonly disclosure?: string;
    }
  | {
      readonly variant: 'expanded';
      readonly id: string;
    };

const SOURCE_LOGOS = {
  GitHub: '/connectors/github.svg',
  'Google Drive': '/connectors/google-drive.svg',
  Linear: '/connectors/linear.svg',
  Meeting: '/connectors/google-meet.svg',
  Sentry: '/connectors/sentry.svg',
  Slack: '/connectors/slack.svg',
  Telegram: '/connectors/telegram.svg',
} as const;

type BrandedSource = keyof typeof SOURCE_LOGOS;
type SourceIcon = BrandedSource | 'Documents' | 'Email';

const HERO_SOURCES = [
  {
    id: 'telegram',
    x: 90,
    y: 110,
    name: 'Telegram',
    icon: 'Telegram',
    time: '08:46',
    path: 'C180 110 180 300 300 300',
    delay: '0s',
  },
  {
    id: 'slack',
    x: 510,
    y: 110,
    name: 'Slack',
    icon: 'Slack',
    time: '09:14',
    path: 'C420 110 420 300 300 300',
    delay: '0.45s',
  },
  {
    id: 'meeting',
    x: 90,
    y: 510,
    name: 'Meeting',
    icon: 'Meeting',
    time: '11:40',
    path: 'C180 510 180 300 300 300',
    delay: '0.9s',
  },
  {
    id: 'github',
    x: 510,
    y: 510,
    name: 'GitHub',
    icon: 'GitHub',
    time: '15:22',
    path: 'C420 510 420 300 300 300',
    delay: '1.35s',
  },
  {
    id: 'documents',
    x: 90,
    y: 250,
    name: 'Documents',
    icon: 'Documents',
    time: '17:08',
    path: 'C180 250 180 300 300 300',
    delay: '1.8s',
  },
  {
    id: 'sentry',
    x: 510,
    y: 370,
    name: 'Sentry',
    icon: 'Sentry',
    time: '18:21',
    path: 'C420 370 420 300 300 300',
    delay: '2.25s',
  },
  {
    id: 'email',
    x: 90,
    y: 380,
    name: 'Email',
    icon: 'Email',
    time: '10:05',
    path: 'C180 380 180 300 300 300',
    delay: '2.7s',
  },
  {
    id: 'drive',
    x: 300,
    y: 70,
    name: 'Google Drive',
    icon: 'Google Drive',
    time: '10:42',
    path: 'C300 70 300 300 300 300',
    delay: '3.15s',
  },
  {
    id: 'linear',
    x: 510,
    y: 240,
    name: 'Linear',
    icon: 'Linear',
    time: '14:30',
    path: 'C420 240 420 300 300 300',
    delay: '3.6s',
  },
] as const satisfies readonly {
  id: string;
  name: string;
  icon: SourceIcon;
  time: string;
  path: string;
  x: number;
  y: number;
  delay: string;
}[];

// The outer paths end at the same coordinates as the source tiles.
const HERO_APPROACH_PATHS = HERO_SOURCES.map((source) => {
  if (source.x === 300) return `M300 -500 C300 -200 300 -80 300 ${source.y}`;
  const side = source.x < 300 ? -1 : 1;
  const outerX = side < 0 ? -800 : 1100;
  const outerY = source.y + (source.y - 300) * 1.4;
  return `M${outerX} ${outerY} C${outerX} ${source.y} ${source.x + side * 200} ${source.y} ${source.x} ${source.y}`;
});

const HERO_OUTCOME_PATH = 'M300 384 C300 410 300 434 300 456';

const FLOW_STORY = PUBLIC_DEMO_STORY.landing.flow;

export function TimelineFlowDiagram(props: TimelineFlowDiagramProps) {
  if (props.variant === 'expanded') return <ExpandedTimelineFlow id={props.id} />;

  return <HeroTimelineFlow disclosure={props.disclosure} />;
}

function heroCardPosition(point: { x: number; y: number }): CSSProperties {
  return { left: `${point.x / 6}%`, top: `${point.y / 6}%` };
}

function heroSourcePath(source: (typeof HERO_SOURCES)[number]): string {
  return `M${source.x} ${source.y} ${source.path}`;
}

function HeroTimelineFlow({ disclosure }: { readonly disclosure?: string }) {
  return (
    <figure
      id="hero-work-flow"
      className={styles.observatory}
      data-home-diagram
      aria-label="Work events stream from nine sources into The Timeline, where the work record keeps decisions, promises and next steps connected to their sources."
    >
      <HeroFlowControls />

      <svg
        className={styles.orbitLines}
        viewBox="0 0 600 600"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
        data-flow-motion
      >
        <defs>
          <linearGradient
            id="hero-field-fade"
            x1="-500"
            y1="0"
            x2="900"
            y2="0"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="white" stopOpacity="0" />
            <stop offset="0.38" stopColor="white" stopOpacity="0.4" />
            <stop offset="0.6" stopColor="white" />
            <stop offset="1" stopColor="white" stopOpacity="0.1" />
          </linearGradient>
          <mask
            id="hero-field-mask"
            x="-900"
            y="-300"
            width="2200"
            height="1400"
            maskUnits="userSpaceOnUse"
          >
            <rect x="-900" y="-300" width="2200" height="1400" fill="url(#hero-field-fade)" />
          </mask>
        </defs>
        <g className={styles.heroSignalField} mask="url(#hero-field-mask)">
          {HERO_APPROACH_PATHS.map((path, index) => (
            <g key={path}>
              <path className={styles.heroFieldRoute} d={path} />
              <path
                className={styles.heroFieldSignal}
                d={path}
                pathLength="1"
                strokeDasharray="0.075 0.925"
              >
                <animate
                  attributeName="stroke-dashoffset"
                  values="1;0;0"
                  keyTimes="0;0.25;1"
                  dur="12s"
                  begin={HERO_SOURCES[index]?.delay}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0;0.65;0.65;0;0"
                  keyTimes="0;0.03;0.22;0.25;1"
                  dur="12s"
                  begin={HERO_SOURCES[index]?.delay}
                  repeatCount="indefinite"
                />
              </path>
            </g>
          ))}
        </g>
        <g className={styles.heroArrival}>
          {HERO_SOURCES.map((source) => (
            <circle key={source.id} cx={source.x} cy={source.y} r="32">
              <animate
                attributeName="r"
                values="24;40;40"
                keyTimes="0;0.08;1"
                dur="12s"
                begin={`${parseFloat(source.delay) + 3}s`}
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="0.5;0;0"
                keyTimes="0;0.08;1"
                dur="12s"
                begin={`${parseFloat(source.delay) + 3}s`}
                repeatCount="indefinite"
              />
            </circle>
          ))}
          <circle cx="300" cy="300" r="108">
            <animate
              attributeName="opacity"
              values="0;0.5;0;0"
              keyTimes="0;0.04;0.12;1"
              dur="12s"
              begin="8.6s"
              repeatCount="indefinite"
            />
          </circle>
        </g>
        <g className={styles.evidencePaths}>
          {HERO_SOURCES.map((source) => (
            <path key={source.id} d={heroSourcePath(source)} data-hero-flow-path="ingest" />
          ))}
        </g>
        <g className={styles.heroIngestTraces}>
          {HERO_SOURCES.map((source) => (
            <path
              key={source.id}
              d={heroSourcePath(source)}
              pathLength="1"
              strokeDasharray="0.22 0.78"
            >
              <animate
                attributeName="stroke-dashoffset"
                values="1;0;0"
                keyTimes="0;0.18;1"
                dur="12s"
                begin={`${parseFloat(source.delay) + 3}s`}
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="0;0.8;0.8;0;0"
                keyTimes="0;0.02;0.15;0.18;1"
                dur="12s"
                begin={`${parseFloat(source.delay) + 3}s`}
                repeatCount="indefinite"
              />
            </path>
          ))}
        </g>
        <path className={styles.outcomePath} d={HERO_OUTCOME_PATH} data-hero-flow-path="outcome" />
        <g className={styles.ingestPackets}>
          {HERO_SOURCES.map((source) => (
            <FlowPacket
              key={source.id}
              path={heroSourcePath(source)}
              begin={`${parseFloat(source.delay) + 3}s`}
              dataType="ingest"
            />
          ))}
        </g>
        <g className={styles.outcomePacket}>
          <FlowPacket path={HERO_OUTCOME_PATH} begin="9.1s" dataType="outcome" />
        </g>
        <HeroRecordMesh />
      </svg>

      <div
        className={styles.heroOutcome}
        aria-label="Decisions, promises and next steps with sources attached"
      >
        <strong>Decisions, promises &amp; next steps</strong>
        <small>
          <Link2 size={12} aria-hidden="true" /> Sources attached
        </small>
      </div>

      <ul className={styles.orbitSources} aria-label="Example sources entering The Timeline">
        {HERO_SOURCES.map((source) => (
          <li key={source.id} className={styles.orbitSource} style={heroCardPosition(source)}>
            <time className={styles.orbitSourceTime}>{source.time}</time>
            <span className={styles.orbitSourceIdentity}>
              <SourceLogo source={source.icon} className={styles.orbitSourceLogo} />
              <strong>{source.name}</strong>
            </span>
          </li>
        ))}
      </ul>
      {disclosure ? (
        <figcaption className={styles.observatoryCaption}>{disclosure}</figcaption>
      ) : null}
    </figure>
  );
}

function FlowPacket({
  path,
  begin,
  dataType,
}: {
  readonly path: string;
  readonly begin: string;
  readonly dataType: 'ingest' | 'outcome';
}) {
  return (
    <circle r={dataType === 'outcome' ? 4 : 5} data-hero-flow-packet={dataType}>
      <animateMotion
        path={path}
        begin={begin}
        dur="12s"
        keyPoints="0;1;1"
        keyTimes={dataType === 'outcome' ? '0;0.1;1' : '0;0.18;1'}
        calcMode="linear"
        repeatCount="indefinite"
      />
      <animate
        attributeName="opacity"
        values="0;1;1;0;0"
        keyTimes={dataType === 'outcome' ? '0;0.01;0.08;0.1;1' : '0;0.02;0.15;0.18;1'}
        begin={begin}
        dur="12s"
        repeatCount="indefinite"
      />
    </circle>
  );
}

function ExpandedTimelineFlow({ id }: { readonly id: string }) {
  const titleId = `${id}-title`;

  return (
    <section id={id} className={styles.flowExplainer} data-flow-explainer aria-labelledby={titleId}>
      <header className={styles.flowExplainerHeader}>
        <span className={styles.monoLabel}>The platform flow</span>
        <div>
          <h2 id={titleId}>How scattered work becomes useful context.</h2>
          <p>Sources become history, working records and verifiable answers.</p>
          <TimelineFlowMotion targetId={id} />
        </div>
      </header>

      <div className={styles.flowSequence}>
        <article className={styles.flowStage} data-flow-step="evidence">
          <FlowStageHeading
            index="01"
            label="Evidence"
            title="Connect"
            subtitle="Chats, files, meetings and system events keep their source."
          />
          <ul className={styles.flowSourceList} aria-label="Grouped Timeline evidence sources">
            {FLOW_STORY.evidenceGroups.map((source) => (
              <li key={source.id} data-flow-item data-flow-group={source.id}>
                <FlowSourceGroupLogos sources={source.icons} />
                <span>
                  <strong>{source.label}</strong>
                  <small>{source.detail}</small>
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.flowMoreSources}>
            + Any source via a pre-built integration or webhook
          </p>
          <p className={styles.flowStageBoundary}>Only sources your team selects or sends enter.</p>
        </article>

        <FlowConnector label="preserve" kind="preserve" />

        <article className={styles.flowStage} data-flow-step="timeline">
          <FlowStageHeading
            index="02"
            label="Timeline"
            title="Capture"
            subtitle="Timestamped, source-linked and kept in order."
          />
          <div className={styles.flowTimelineViewport}>
            <FlowPacketTrack direction="vertical" kind="timeline" />
            <ol className={styles.flowMiniTimeline}>
              {FLOW_STORY.timelineEvents.map((event) => (
                <li key={event.id} data-flow-item>
                  <div className={styles.flowTimelineMeta}>
                    <span>[{event.id}]</span>
                    <time dateTime={event.dateTime}>{event.stamp}</time>
                    <em>{event.source}</em>
                  </div>
                  <strong>{event.title}</strong>
                </li>
              ))}
            </ol>
          </div>
          <p className={styles.flowStageBoundary}>Original evidence stays attached.</p>
        </article>

        <FlowConnector label="organize" kind="organize" />

        <article className={styles.flowStage} data-flow-step="workspace">
          <FlowStageHeading
            index="03"
            label="Workspace"
            title="Approve"
            subtitle="History becomes records your team can run."
          />
          <ul className={styles.flowRecordGrid} aria-label="Example Timeline working context">
            {FLOW_STORY.workspaceRecords.map((record) => (
              <li key={`${record.type}-${record.title}`} data-flow-item>
                <span>{record.type}</span>
                <strong>{record.title}</strong>
                <small>{record.detail}</small>
                <em>{record.state}</em>
              </li>
            ))}
          </ul>
          <div className={styles.flowWorkspaceViews}>
            <small>Use the same records in</small>
            <p>{FLOW_STORY.workspaceViews.join(' · ')}</p>
          </div>
          <p className={styles.flowStageBoundary}>
            When a conversation points to a lasting change, such as a new task, owner or deal stage,
            The Timeline proposes it and a person approves it.
          </p>
        </article>

        <FlowConnector label="assist" kind="assist" />

        <article className={styles.flowStage} data-flow-step="assistant">
          <FlowStageHeading
            index="04"
            label="Assistants"
            title="Stay current and ask"
            subtitle="Web, chat and your own agent use the same evidence."
          />
          <ul
            className={styles.flowAgentSurfaces}
            aria-label="Timeline assistant surfaces"
            data-flow-item
          >
            {FLOW_STORY.agent.surfaces.map((surface) => (
              <li key={surface}>{surface}</li>
            ))}
          </ul>
          <div className={styles.flowAgentExchange}>
            <div className={styles.flowQuestion} data-flow-agent-step="question">
              <span>You</span>
              <p>{FLOW_STORY.agent.question}</p>
            </div>
            <div className={styles.flowAgentTransit}>
              <FlowPacketTrack direction="vertical" kind="assistant" />
            </div>
            <div className={styles.flowAnswerText} data-flow-agent-step="answer">
              <span>Timeline</span>
              <CitedAnswer text={FLOW_STORY.agent.answer} />
              <small>{FLOW_STORY.agent.conflict}</small>
            </div>
          </div>
          <p className={styles.flowAgentContext} data-flow-agent-step="context">
            Live CRM via MCP · {FLOW_STORY.agent.clients.join(' · ')}
          </p>
        </article>
      </div>

      <div className={styles.flowExplainerFooter}>
        <span>Sources stay attached.</span>
        <span>Timeline record changes need approval.</span>
        <span>Enabled MCP tools can read or update connected systems such as your CRM.</span>
      </div>
    </section>
  );
}

function FlowStageHeading({
  index,
  label,
  title,
  subtitle,
}: {
  readonly index: string;
  readonly label: string;
  readonly title: string;
  readonly subtitle: string;
}) {
  return (
    <header className={styles.flowStageHeading}>
      <span className={styles.flowStageKicker}>
        <i aria-hidden="true" />
        {index} / {label}
      </span>
      <h3>{title}</h3>
      <p>{subtitle}</p>
    </header>
  );
}

function FlowConnector({
  label,
  kind,
}: {
  readonly label: string;
  readonly kind: 'preserve' | 'organize' | 'assist';
}) {
  return (
    <div
      className={styles.flowConnector}
      data-flow-step={`connector-${kind}`}
      data-flow-connector={kind}
      aria-hidden="true"
    >
      <FlowPacketTrack direction="horizontal" kind={kind} />
      <small>{label}</small>
    </div>
  );
}

function FlowPacketTrack({
  direction,
  kind,
}: {
  readonly direction: 'horizontal' | 'vertical';
  readonly kind: 'preserve' | 'timeline' | 'organize' | 'assist' | 'assistant';
}) {
  return (
    <span
      className={cn(
        styles.flowPacketTrack,
        direction === 'horizontal'
          ? styles.flowPacketTrackHorizontal
          : styles.flowPacketTrackVertical,
      )}
      aria-hidden="true"
    >
      <span className={styles.flowPacketRunner} data-flow-packet={kind} />
    </span>
  );
}

function CitedAnswer({ text }: { readonly text: string }) {
  return (
    <p>
      {text.split(/(\[\d+\])/u).map((part, index) =>
        /^\[\d+\]$/u.test(part) ? (
          <mark key={`${part}-${String(index)}`} data-flow-citation>
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </p>
  );
}

function isSourceIcon(source: string): source is SourceIcon {
  return source === 'Documents' || source === 'Email' || source in SOURCE_LOGOS;
}

function FlowSourceGroupLogos({ sources }: { readonly sources: readonly string[] }) {
  return (
    <span className={styles.flowSourceLogos} aria-hidden="true">
      {sources.map((source) =>
        isSourceIcon(source) ? (
          <SourceLogo key={source} source={source} className={styles.flowSourceLogo} />
        ) : null,
      )}
    </span>
  );
}

function SourceLogo({
  source,
  className,
}: {
  readonly source: SourceIcon;
  readonly className?: string;
}) {
  return (
    <span className={className} aria-hidden="true">
      {source === 'Documents' ? (
        <FileText />
      ) : source === 'Email' ? (
        <Mail />
      ) : (
        <Image src={SOURCE_LOGOS[source]} alt="" width={18} height={18} />
      )}
    </span>
  );
}
