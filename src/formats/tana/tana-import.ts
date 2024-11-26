import { TanaDatabase, TanaDoc } from './models/tana-json';

const inlineRefRegex = /<span data-inlineref-node="(.+)"><\/span>/g;
const boldRegex = /<b>(.*?)<\/b>/g;
const italicRegex = /<i>(.*?)<\/i>/g;

export class TanaGraphImporter {
	public result: Map<string, string> = new Map();
	private tanaDatabase: TanaDatabase;
	private nodes: Map<string, TanaDoc>;
	private convertedNodes: Set<string> = new Set();
	public fatalError: string | null;
	public notices: string[] = [];
	private anchors: Set<string> = new Set();
	private topLevelNodes = new Map<string, [TanaDoc, string]>();

	public importTanaGraph(data: string) {
		this.tanaDatabase = JSON.parse(data) as TanaDatabase;
		this.nodes = new Map();
		this.tanaDatabase.docs.forEach(n => this.nodes.set(n.id, n));


		const rootNode = this.tanaDatabase.docs.find(n => n.props.name && n.props.name.startsWith('Root node for'));
		if (!rootNode) {
			this.fatalError = 'Root node not found';
			return;
		}
		this.convertedNodes.add(rootNode.id);

		this.prepareAnchors(rootNode);

		const workspaceNode = this.nodes.get(rootNode.children[0]);
		if (!workspaceNode) {
			this.fatalError = 'Workspace node not found';
			return;
		}
		this.convertedNodes.add(workspaceNode.id);

		let metaNodeId = workspaceNode.props._metaNodeId;
		if (metaNodeId) {
			const metaNode = this.nodes.get(metaNodeId);
			if (metaNode) {
				this.markSeen(metaNode);
			}
		}

		const libraryNode = this.nodes.get(rootNode.id + '_STASH');
		if (libraryNode != null) {
			this.importLibraryNode(libraryNode);
		}
		else {
			this.notices.push('Library node not found');
		}

		for (let suffix of ['_TRASH', '_SCHEMA', '_SIDEBAR_AREAS', '_USERS', '_SEARCHES', '_MOVETO', '_WORKSPACE']) {
			const specialNode = this.nodes.get(rootNode.id + suffix);
			if (specialNode != null) {
				this.markSeen(specialNode);
			}
			else {
				this.notices.push('Special node ' + suffix + ' not found');
			}
		}

		this.enumerateChildren(workspaceNode, (childNode) => {
			if (childNode.props._docType == 'journal') {
				this.importDailyNotes(childNode);
			}
		});

		for (const [node, file] of this.topLevelNodes.values()) {
			this.convertNode(node, file);
		}

		this.notices.push('Converted ' + this.convertedNodes.size + ' nodes');
		let unconverted = 0;
		for (let node of this.tanaDatabase.docs) {
			if (!this.convertedNodes.has(node.id) && !node.id.startsWith('SYS') &&
				node.props._docType != 'workspace') {
				this.notices.push('Found unconverted node: ' + node.id);
				unconverted++;
				if (unconverted == 20) break;
			}
		}
	}

	private prepareAnchors(node: TanaDoc) {
		if (node.props.name) {
			for (let m of node.props.name.matchAll(inlineRefRegex)) {
				this.anchors.add(m[1]);
			}
		}
		this.enumerateChildren(node, (childNode) => {
			if (childNode.props._ownerId != node.id) {
				this.anchors.add(childNode.id);
			}
			this.prepareAnchors(childNode);
		});
	}

	private importDailyNotes(node: TanaDoc) {
		this.convertedNodes.add(node.id);
		this.enumerateChildren(node, (yearNode) => {
			this.convertedNodes.add(yearNode.id);
			this.enumerateChildren(yearNode, (weekNode) => {
				this.convertedNodes.add(weekNode.id);
				this.enumerateChildren(weekNode, (dayNode) => {
					if (dayNode.props.name) {
						this.topLevelNodes.set(dayNode.id, [dayNode, dayNode.props.name]);
					}
				});
			});
		});
	}

	private importLibraryNode(node: TanaDoc) {
		this.convertedNodes.add(node.id);
		this.enumerateChildren(node, (childNode) => {
			this.topLevelNodes.set(childNode.id, [childNode, childNode.props.name]);
		});
	}

	private convertNode(node: TanaDoc, filename: string) {
		const fragments: Array<string> = [];
		this.convertNodeRecursive(node, fragments, 0);
		this.result.set(filename + '.md', fragments.join('\n'));
	}

	private convertNodeRecursive(node: TanaDoc, fragments: string[], indent: number) {
		if (node.props._docType == 'tuple') {
			this.markSeen(node);
			return;
		}

		this.convertedNodes.add(node.id);
		if (node.props._metaNodeId) {
			this.convertMetaNode(this.nodes.get(node.props._metaNodeId), fragments, indent);
		}
		if (indent > 0) {
			const prefix = ' '.repeat(indent * 2) + '*';
			const anchor = this.anchors.has(node.id) ? (' ^' + node.id.replace('_', '-')) : '';
			fragments.push(prefix + ' ' + this.convertMarkup(node.props.name ?? '') + anchor);
		}
		this.enumerateChildren(node, (child) => {
			if (child.props._ownerId === node.id) {  // skip nodes which are included by reference
				this.convertNodeRecursive(child, fragments, indent + 1);
			}
			else {
				fragments.push(this.generateLink(child.id));
			}
		});
	}

	private convertMetaNode(node: TanaDoc | undefined, fragments: string[], indent: number) {
		if (!node) return;
		if (node.props.name) {
			fragments.push('#' + node.props.name);
		}
		this.convertedNodes.add(node.id);
		this.enumerateChildren(node, (child => this.convertMetaNode(child, fragments, indent)));
	}

	private generateLink(id: string): string {
		const tlNode = this.topLevelNodes.get(id);
		if (tlNode) {
			return '[[' + tlNode[1] + ']]';
		}
		const targetNode = this.nodes.get(id);
		if (targetNode) {
			const tlParent = this.findTopLevelParent(targetNode);
			if (tlParent) {
				const tlFileName = this.topLevelNodes.get(tlParent.id)![1];
				return '[[' + tlFileName + '#^' + id.replace('_', '-') + ']]';
			}
		}

		return '[[#]]';
	}

	private findTopLevelParent(node: TanaDoc): TanaDoc | null {
		const ownerId = node.props._ownerId;
		if (!ownerId) return null;
		const ownerNode = this.nodes.get(ownerId);
		if (ownerNode) {
			if (this.topLevelNodes.has(ownerNode.id)) {
				return ownerNode;
			}
			return this.findTopLevelParent(ownerNode);
		}
		return null;
	}

	private convertMarkup(text: string): string {
		return text
			.replace(inlineRefRegex, (_, id) => this.generateLink(id))
			.replace(boldRegex, (_, content) => '**' + content + '**')
			.replace(italicRegex, (_, content) => '*' + content + '*');
	}

	private markSeen(node: TanaDoc) {
		if (this.convertedNodes.has(node.id)) return;
		this.convertedNodes.add(node.id);
		this.enumerateChildren(node, (child) => this.markSeen(child));
		if (node.props._metaNodeId) {
			const metaNode = this.nodes.get(node.props._metaNodeId);
			if (metaNode) {
				this.markSeen(metaNode);
			}
		}
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
				this.notices.push('Node with id ' + childId + ' (parent ' + (node.props.name ?? node.id) + ') not found');
			}
		}
	}
}
