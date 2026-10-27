import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import PageTransition, { StaggerGroup, StaggerItem } from "./PageTransition";

export default function PageHeader({ eyebrow, title, description, backTo, backLabel = "Back", actions }) {
  return (
    <PageTransition>
      <StaggerGroup className="flex flex-wrap items-end justify-between gap-4">
        <StaggerItem>
          {backTo ? (
            <Link
              to={backTo}
              className="link mb-2.5 inline-flex items-center gap-1.5 text-[13px]"
            >
              <ArrowLeft size={13} /> {backLabel}
            </Link>
          ) : null}
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h1 className="mt-1 text-2xl font-extrabold text-navy-900">{title}</h1>
          {description ? (
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-500">{description}</p>
          ) : null}
        </StaggerItem>
        {actions ? <StaggerItem className="flex flex-wrap items-center gap-3">{actions}</StaggerItem> : null}
      </StaggerGroup>
    </PageTransition>
  );
}
