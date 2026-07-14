import ClassLog from "./ClassLog";

/**
 * The redesigned Classes route deliberately reuses the production Class Log
 * workflow. This keeps attendance, detailed payments, advance allocations,
 * editing, filters, and validation in one source of truth.
 */
export default function Classes(props) {
  return (
    <div className="page redesigned-classes-page">
      <div className="page-heading">
        <div>
          <h1>Classes</h1>
          <p>Schedule, record, and review group or individual classes.</p>
        </div>
      </div>
      <ClassLog {...props} />
    </div>
  );
}
