const BACKEND_API_URL = import.meta.env.VITE_BACKEND_API_URL || 'http://localhost:3000';

export const saveNoteToBackend = async (path: string, markdown: string) => {
	const response = await fetch(`${BACKEND_API_URL}/markdown`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			path,
			markdown
		})
	});

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
		throw new Error(`Backend API error: ${errorData.error || response.statusText}`);
	}

	return response.json();
};

export const fetchNotesFromBackend = async (path: string) => {
	const response = await fetch(`${BACKEND_API_URL}/markdown`);
	if (!response.ok) {
		const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
		throw new Error(`Backend API error: ${errorData.error || response.statusText}`);
	}
	const data = await response.json();
	return data;
};

export const fetchNoteContentFromBackend = async (path: string) => {
	const response = await fetch(
		`${BACKEND_API_URL}/markdown/content?path=${encodeURIComponent(path)}`
	);
	if (!response.ok) {
		const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
		throw new Error(`Backend API error: ${errorData.error || response.statusText}`);
	}
	return await response.json();
};

export const fetchAllItemNames = async (dirPath: string) => {
	const response = await fetch(
		`${BACKEND_API_URL}/markdown/names?dirPath=${encodeURIComponent(dirPath)}`
	);
	if (!response.ok) {
		const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
		throw new Error(`Backend API error: ${errorData.error || response.statusText}`);
	}
	const data = await response.json();
	return data;
};

export const createFolderInBackend = async (path: string) => {
	const response = await fetch(`${BACKEND_API_URL}/markdown/folder`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			path
		})
	});

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
		throw new Error(`Backend API error: ${errorData.error || response.statusText}`);
	}

	return response.json();
};

export const deleteItemInBackend = async (path: string, recursive = false) => {
	const response = await fetch(
		`${BACKEND_API_URL}/markdown?path=${encodeURIComponent(path)}&recursive=${recursive}`,
		{
			method: 'DELETE'
		}
	);

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
		throw new Error(`Backend API error: ${errorData.error || response.statusText}`);
	}
	return response.json();
};
