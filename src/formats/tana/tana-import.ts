import { TanaDatabase, TanaDoc } from './models/tana-json';

export class TanaGraphImporter {
	public result: Map<string, string> = new Map();
	private tanaDatabase: TanaDatabase;
	private nodes: Map<string, TanaDoc>;

	public importTanaGraph(data: string) {
		this.tanaDatabase = JSON.parse(data) as TanaDatabase;
		this.nodes = new Map();
		this.tanaDatabase.docs.forEach(n => this.nodes.set(n.id, n));

		const rootNode = this.tanaDatabase.docs.find(n => n.props.name && n.props.name.startsWith('Root node for'));
		if (!rootNode) {
			console.log('Root node not found');
			return;
		}

		const workspaceNode = this.nodes.get(rootNode.children[0]);
		if (!workspaceNode) {
			console.log('Workspace node not found');
			return;
		}

		this.enumerateChildren(workspaceNode, (childNode) => {
			if (childNode.props._docType == 'journal') {
				this.importDailyNotes(childNode);
			}
		});
	}

	private importDailyNotes(node: TanaDoc) {
		this.enumerateChildren(node, (yearNode) => {
			this.enumerateChildren(yearNode, (weekNode) => {
				this.enumerateChildren(weekNode, (dayNode) => {
					if (dayNode.props.name) {
						this.convertNode(dayNode, dayNode.props.name);
					}
				});
			});
		});
	}

	private convertNode(node: TanaDoc, filename: string) {
		const fragments: Array<string> = [];
		this.enumerateChildren(node, (child) => {
			this.convertNodeRecursive(child, fragments, 0);
		});
		this.result.set(filename + '.md', fragments.join('\n'));
	}

	private convertNodeRecursive(node: TanaDoc, fragments: Array<string>, indent: number) {
		const prefix = ' '.repeat(indent * 2) + '*';
		fragments.push(prefix + ' ' + node.props.name);
		this.enumerateChildren(node, (child) => {
			this.convertNodeRecursive(child, fragments, indent + 1);
		});
	}

	private enumerateChildren(node: TanaDoc, callback: (child: TanaDoc) => void) {
		if (!node.children) return;
		for (const childId of node.children) {
			if (childId.startsWith('SYS_')) continue;
			const childNode = this.nodes.get(childId);
			if (childNode) {
				callback(childNode);
			}
			else {
				console.log('Node with id ' + childId + ' not found');
			}
		}
	}
}
