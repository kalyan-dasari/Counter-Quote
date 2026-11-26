import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { deleteJob, getJobs } from '../api';
import { formatCurrency } from '../quote';

function formatShape(shape: string): string {
  switch (shape) {
    case 'l-shape':
      return 'L-Shape';
    case 'u-shape':
      return 'U-Shape';
    case 'custom':
      return 'Custom';
    default:
      return 'Rectangle';
  }
}

export function JobsPage() {
  const queryClient = useQueryClient();
  const { data: jobs, error } = useQuery({ queryKey: ['jobs'], queryFn: getJobs });

  const remove = useMutation({
    mutationFn: deleteJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });

  if (error) return <p className="errors">{error.message}</p>;
  if (!jobs) return <p>Loading…</p>;

  return (
    <>
      <div className="list-header">
        <h1>Countertop Quotes</h1>
        <Link to="/jobs/new" className="button">
          + New Quote
        </Link>
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Customer</th>
            <th>Material</th>
            <th>Shape</th>
            <th>Area</th>
            <th>Edge Profile</th>
            <th>Estimated Total</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td>{job.id}</td>
              <td>
                <Link to={`/jobs/${job.id}`} className="job-link">
                  {job.customerName}
                </Link>
              </td>
              <td>
                {job.material} ({job.thickness || '3cm'})
              </td>
              <td>{formatShape(job.shapeType)}</td>
              <td>{job.areaSqFt > 0 ? `${job.areaSqFt} sq ft` : '—'}</td>
              <td>{job.edgeProfile || 'Eased'}</td>
              <td>
                <strong>{job.totalPrice > 0 ? formatCurrency(job.totalPrice) : 'Not drawn'}</strong>
              </td>
              <td className="actions-cell">
                <Link to={`/jobs/${job.id}`} className="btn-chip">
                  Open
                </Link>
                <button
                  type="button"
                  className="btn-chip danger"
                  onClick={() => {
                    if (window.confirm(`Delete quote for "${job.customerName}"?`)) {
                      remove.mutate(job.id);
                    }
                  }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
