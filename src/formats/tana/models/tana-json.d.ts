export interface TanaProps {
	created: number;
	name: string;
	description: string;
	_docType: string | null;
	_ownerId: string;
}

export interface TanaDoc {
	id: string;
	props: TanaProps;
	children: string[];
}

export interface TanaDatabase {
	formatVersion: number;
	docs: TanaDoc[];
}
