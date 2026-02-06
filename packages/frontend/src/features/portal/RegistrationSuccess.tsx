import { Link } from 'react-router-dom';
import { CheckCircleIcon } from '@heroicons/react/24/outline';

export default function RegistrationSuccess() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <div className="flex justify-center">
            <CheckCircleIcon className="h-16 w-16 text-green-500" />
          </div>

          <h2 className="mt-6 text-center text-2xl font-bold text-gray-900">
            Application Submitted
          </h2>

          <p className="mt-4 text-center text-sm text-gray-600">
            Thank you for submitting your provider registration application.
            Our team will review your information and get back to you shortly.
          </p>

          <div className="mt-6 bg-primary-50 border border-primary-200 rounded-md p-4">
            <h3 className="text-sm font-medium text-primary-800">What happens next?</h3>
            <ul className="mt-2 text-sm text-primary-700 list-disc list-inside space-y-1">
              <li>Our credentialing team will review your application</li>
              <li>You may be contacted for additional information</li>
              <li>You will receive an email notification once approved</li>
            </ul>
          </div>

          <div className="mt-6 flex flex-col gap-3">
            <Link
              to="/register"
              className="w-full flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              Submit Another Application
            </Link>
            <Link
              to="/login"
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              Go to Login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
