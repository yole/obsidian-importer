export interface TanaProps {
	created: number;
	name: string;
	description: string;
	_docType: string | null;
	_ownerId: string;
	_metaNodeId: string | null;
	_flags: number | null;
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
