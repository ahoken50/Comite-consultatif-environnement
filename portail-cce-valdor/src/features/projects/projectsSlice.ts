import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { Project, LinkedResolution } from '../../types/project.types';
import type { ProjectTask } from '../../types/task.types';
import { projectsAPI } from './projectsAPI';
import { logProjectActivity } from '../../services/activityLogService';

interface ProjectsState {
    items: Project[];
    tasksByProjectId: Record<string, ProjectTask[]>;
    loading: boolean;
    error: string | null;
}

const initialState: ProjectsState = {
    items: [],
    tasksByProjectId: {},
    loading: false,
    error: null,
};

// Fetch all projects
export const fetchProjects = createAsyncThunk(
    'projects/fetchAll',
    async () => {
        return await projectsAPI.fetchAll();
    }
);

// Create a new project
export const createProject = createAsyncThunk(
    'projects/create',
    async ({ project, userId, userName }: {
        project: Omit<Project, 'id'>;
        userId: string;
        userName: string;
    }) => {
        const created = await projectsAPI.create(project);
        // Log activity
        await logProjectActivity('project_created', userId, userName, created.id, created.name);
        return created;
    }
);

// Update a project
export const updateProject = createAsyncThunk(
    'projects/update',
    async ({ id, updates, userId, userName, projectName }: {
        id: string;
        updates: Partial<Project>;
        userId: string;
        userName: string;
        projectName: string;
    }) => {
        await projectsAPI.update(id, updates);
        // Log activity (check if completed)
        const activityType = updates.status === 'completed' ? 'project_completed' : 'project_updated';
        await logProjectActivity(activityType, userId, userName, id, projectName);
        return { id, updates };
    }
);

// Delete a project
export const deleteProject = createAsyncThunk(
    'projects/delete',
    async ({ id, userId, userName, projectName }: {
        id: string;
        userId: string;
        userName: string;
        projectName: string;
    }) => {
        await projectsAPI.delete(id);
        // Log activity
        await logProjectActivity('project_deleted', userId, userName, id, projectName);
        return id;
    }
);

// Task Thunks
export const fetchProjectTasks = createAsyncThunk(
    'projects/fetchTasks',
    async (projectId: string) => {
        const tasks = await projectsAPI.fetchTasks(projectId);
        return { projectId, tasks };
    }
);

export const addTask = createAsyncThunk(
    'projects/addTask',
    async ({ projectId, task, userId, userName, projectName }: {
        projectId: string;
        task: Omit<ProjectTask, 'id' | 'projectId' | 'dateCreated'>;
        userId: string;
        userName: string;
        projectName: string;
    }) => {
        const created = await projectsAPI.addTask(projectId, task);
        // Log activity
        await logProjectActivity('task_created', userId, userName, projectId, `${projectName}: ${task.description}`);
        return created;
    }
);

export const updateTask = createAsyncThunk(
    'projects/updateTask',
    async ({ projectId, taskId, updates, userId, userName, projectName }: {
        projectId: string;
        taskId: string;
        updates: Partial<ProjectTask>;
        userId: string;
        userName: string;
        projectName: string;
    }) => {
        await projectsAPI.updateTask(projectId, taskId, updates);
        // Log if completed
        if (updates.status === 'completed') {
            await logProjectActivity('task_completed', userId, userName, projectId, `${projectName} (Tâche terminée)`);
        }
        return { projectId, taskId, updates };
    }
);

export const deleteTask = createAsyncThunk(
    'projects/deleteTask',
    async ({ projectId, taskId, userId, userName, projectName }: {
        projectId: string;
        taskId: string;
        userId: string;
        userName: string;
        projectName: string;
    }) => {
        await projectsAPI.deleteTask(projectId, taskId);
        await logProjectActivity('task_deleted', userId, userName, projectId, `${projectName} (Tâche supprimée)`);
        return { projectId, taskId };
    }
);

export const addComment = createAsyncThunk(
    'projects/addComment',
    async ({ projectId, comment, projectName, userId, userName }: {
        projectId: string;
        comment: any;
        projectName: string;
        userId: string;
        userName: string;
    }) => {
        await projectsAPI.addComment(projectId, comment);
        await logProjectActivity('comment_added', userId, userName, projectId, `${projectName}: Nouveau commentaire`);
        return { projectId, comment };
    }
);

export const addCaucusDecision = createAsyncThunk(
    'projects/addCaucusDecision',
    async ({ projectId, decision, projectName, userId, userName }: {
        projectId: string;
        decision: any;
        projectName: string;
        userId: string;
        userName: string;
    }) => {
        await projectsAPI.addCaucusDecision(projectId, decision);
        await logProjectActivity('project_updated', userId, userName, projectId, `${projectName}: Nouvelle décision caucus`);
        return { projectId, decision };
    }
);

// Link a CCE resolution/comment to a project
export const linkResolutionToProject = createAsyncThunk(
    'projects/linkResolution',
    async ({ projectId, resolution, projectName, userId, userName }: {
        projectId: string;
        resolution: LinkedResolution;
        projectName: string;
        userId: string;
        userName: string;
    }) => {
        await projectsAPI.linkResolution(projectId, resolution);
        await logProjectActivity('project_updated', userId, userName, projectId,
            `${projectName}: Résolution liée (${resolution.entryNumber} - ${resolution.meetingTitle})`);
        
        // Fetch updated project to get new linkedMeetingIds and resolutionCCE
        const updatedProject = await projectsAPI.fetchById(projectId);
        return { projectId, updatedProject };
    }
);

// Unlink a CCE resolution/comment from a project
export const unlinkResolutionFromProject = createAsyncThunk(
    'projects/unlinkResolution',
    async ({ projectId, resolutionId, projectName, userId, userName }: {
        projectId: string;
        resolutionId: string;
        projectName: string;
        userId: string;
        userName: string;
    }) => {
        await projectsAPI.unlinkResolution(projectId, resolutionId);
        await logProjectActivity('project_updated', userId, userName, projectId,
            `${projectName}: Résolution déliée`);
            
        const updatedProject = await projectsAPI.fetchById(projectId);
        return { projectId, updatedProject };
    }
);

// Merge Projects
export const mergeProjects = createAsyncThunk(
    'projects/merge',
    async ({ sourceProjectId, targetProjectId, user, sourceProjectName, targetProjectName }: {
        sourceProjectId: string;
        targetProjectId: string;
        user: any;
        sourceProjectName: string;
        targetProjectName: string;
    }) => { // Removed unused dispatch
        await projectsAPI.mergeProjects(sourceProjectId, targetProjectId, user);

        // Log activity
        await logProjectActivity('project_updated', user.uid, user.displayName, targetProjectId,
            `Fusion du projet ${sourceProjectName} dans ${targetProjectName}`);

        // Return IDs so we can update state locally
        return { sourceProjectId, targetProjectId };
    }
);

const projectsSlice = createSlice({
    name: 'projects',
    initialState,
    reducers: {},
    extraReducers: (builder) => {
        builder
            // Fetch Projects
            .addCase(fetchProjects.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchProjects.fulfilled, (state, action) => {
                state.loading = false;
                state.items = action.payload;
            })
            .addCase(fetchProjects.rejected, (state, action) => {
                state.loading = false;
                state.error = action.error.message || 'Failed to fetch projects';
            })
            // Create Project
            .addCase(createProject.pending, (state) => {
                state.loading = true;
            })
            .addCase(createProject.fulfilled, (state, action) => {
                state.loading = false;
                state.items.unshift(action.payload);
            })
            .addCase(createProject.rejected, (state, action) => {
                state.loading = false;
                state.error = action.error.message || 'Failed to create project';
            })
            // Update Project
            .addCase(updateProject.fulfilled, (state, action) => {
                const { id, updates } = action.payload;
                const index = state.items.findIndex(p => p.id === id);
                if (index !== -1) {
                    state.items[index] = { ...state.items[index], ...updates };
                }
            })
            // Delete Project
            .addCase(deleteProject.fulfilled, (state, action) => {
                state.items = state.items.filter(p => p.id !== action.payload);
            })
            // Fetch Tasks
            .addCase(fetchProjectTasks.fulfilled, (state, action) => {
                state.tasksByProjectId[action.payload.projectId] = action.payload.tasks;
            })
            // Add Task
            .addCase(addTask.fulfilled, (state, action) => {
                const { projectId } = action.payload;
                if (!state.tasksByProjectId[projectId]) {
                    state.tasksByProjectId[projectId] = [];
                }
                state.tasksByProjectId[projectId].push(action.payload);
            })
            // Update Task
            .addCase(updateTask.fulfilled, (state, action) => {
                const { projectId, taskId, updates } = action.payload;
                const tasks = state.tasksByProjectId[projectId];
                if (tasks) {
                    const index = tasks.findIndex(t => t.id === taskId);
                    if (index !== -1) {
                        tasks[index] = { ...tasks[index], ...updates };
                    }
                }
            })
            // Delete Task
            .addCase(deleteTask.fulfilled, (state, action) => {
                const { projectId, taskId } = action.payload;
                if (state.tasksByProjectId[projectId]) {
                    state.tasksByProjectId[projectId] = state.tasksByProjectId[projectId].filter(t => t.id !== taskId);
                }
            })
            .addCase(addComment.fulfilled, (state, action) => {
                const { projectId, comment } = action.payload;
                const project = state.items.find(p => p.id === projectId);
                if (project) {
                    if (!project.comments) project.comments = [];
                    project.comments.push(comment);
                }
            })
            .addCase(addCaucusDecision.fulfilled, (state, action) => {
                const { projectId, decision } = action.payload;
                const project = state.items.find(p => p.id === projectId);
                if (project) {
                    if (!project.caucusDecisions) project.caucusDecisions = [];
                    project.caucusDecisions.push(decision);
                }
            })
            // Link Resolution
            .addCase(linkResolutionToProject.fulfilled, (state, action) => {
                const { projectId, updatedProject } = action.payload;
                if (updatedProject) {
                    const index = state.items.findIndex(p => p.id === projectId);
                    if (index !== -1) {
                        state.items[index] = updatedProject;
                    }
                }
            })
            // Unlink Resolution
            .addCase(unlinkResolutionFromProject.fulfilled, (state, action) => {
                const { projectId, updatedProject } = action.payload;
                if (updatedProject) {
                    const index = state.items.findIndex(p => p.id === projectId);
                    if (index !== -1) {
                        state.items[index] = updatedProject;
                    }
                }
            })
            // Merge Projects
            .addCase(mergeProjects.fulfilled, (state, action) => {
                const { sourceProjectId } = action.payload;
                // Remove source project from list
                state.items = state.items.filter(p => p.id !== sourceProjectId);
                // Ideally we should reload the target project to get merged data, 
                // but since we fetched everything, maybe we trigger a full reload or just let the user refresh?
                // The thunk caller can dispatch fetchProjects() if needed, or we can just invalidate.
            });
    },
});

export default projectsSlice.reducer;
