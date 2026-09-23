import { Compass } from 'lucide-react';
import { ButtonLink } from '../components/common/Button';
import { StateMessage } from '../components/common/StateMessage';
import { useDocumentMeta } from '../hooks/useDocumentMeta';

export default function NotFound() {
  useDocumentMeta('Page not found');
  return (
    <StateMessage
      icon={<Compass size={26} />}
      title="Page not found"
      description="The page you’re looking for doesn’t exist or has moved."
      action={<ButtonLink to="/">Back to IconLab</ButtonLink>}
    />
  );
}
