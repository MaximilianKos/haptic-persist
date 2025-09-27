import { getNextUntitledName } from '@/utils';
import {
	createFolderInBackend,
	deleteItemInBackend,
	fetchAllItemNames,
	moveNoteInBackend,
	renameNoteInBackend
} from './api';

// Create a new folder
export const createFolder = async (dirPath: string) => {
	// Get the entry matching the path
	//const entry = await db.select().from(entryTable).where(eq(entryTable.path, dirPath));

	let files = [];
	// if (entry.length === 0) {
	// 	files = await db
	// 		.select()
	// 		.from(entryTable)
	// 		.where(eq(entryTable.collectionPath, get(collection)));
	// } else {
	// 	files = await db
	// 		.select()
	// 		.from(entryTable)
	// 		.where(
	// 			and(eq(entryTable.parentPath, dirPath), eq(entryTable.collectionPath, get(collection)))
	// 		);
	// }

	files = await fetchAllItemNames(dirPath, true);

	// Generate a new name (Untitled, if there are any exiting Untitled folders, increment the number by 1)
	const name = getNextUntitledName(files, 'Untitled');

	// Save the new folder
	// await db.insert(entryTable).values({
	// 	name,
	// 	path: `${dirPath}/${name}`.replace('//', '/'),
	// 	parentPath: dirPath,
	// 	collectionPath: get(collection),
	// 	isFolder: true
	// });

	await createFolderInBackend(`${dirPath}/${name}`.replace('//', '/'));

	return `${dirPath}/${name}`.replace('//', '/');
};

// Delete a folder
export const deleteFolder = async (path: string) => {
	await deleteItemInBackend(path, true);
};

// Rename a folder
export const renameFolder = async (path: string, name: string) => {
	await renameNoteInBackend(path, name);

	// await db
	// 	.update(entryTable)
	// 	.set({ name, path: `${path.split('/').slice(0, -1).join('/')}/${name}` })
	// 	.where(eq(entryTable.path, path));
};

// Move a folder
export const moveFolder = async (source: string, target: string) => {
	// Use backend API to move the folder (handles conflict checking and recursive file operations)
	try {
		await moveNoteInBackend(source, target);
	} catch (error) {
		// Re-throw with more descriptive error if it's a name conflict
		if (error instanceof Error && error.message.includes('Name conflict')) {
			throw new Error('Name conflict');
		}
		throw error;
	}
};
